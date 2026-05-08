import { format } from 'util';
import * as vscode from 'vscode';
import Configuration from './configuration';
import Stock from './stock';
import { calcFixedNumber, keepDecimal } from './utils';

const stockHub = new Map();
let summaryBarItem: vscode.StatusBarItem | null = null;
let currentStocks: Stock[] = [];

// 超过此数量时显示摘要模式
const SUMMARY_THRESHOLD = 3;

function getItemColor(item: Stock) {
	return item.percent >= 0
		? Configuration.getRiseColor()
		: Configuration.getFallColor();
}

function getItemText(item: Stock) {
	return format(
		'%s %s %s%',
		item.name || item.code,
		keepDecimal(item.price, calcFixedNumber(item)),
		keepDecimal(item.percent * 100, 2),
	);
}

function getTooltipText(item: Stock) {
	const tooltips = [
		'【' + (item.name || item.code) + '】今日行情',
		'涨跌：' + item.updown + '   百分：' + keepDecimal(item.percent * 100, 2) + '%',
		'昨收：' + item.yestclose,
	];
	return tooltips.join('\n');
}

function getSummaryText(stocks: Stock[]) {
	if (stocks.length === 0) return '股票行情';

	let totalPercent = 0;
	let upCount = 0;
	let downCount = 0;

	for (const stock of stocks) {
		totalPercent += stock.percent;
		if (stock.percent > 0) upCount++;
		else if (stock.percent < 0) downCount++;
	}

	const avgPercent = totalPercent / stocks.length;
	const color = avgPercent >= 0 ? Configuration.getRiseColor() : Configuration.getFallColor();
	const arrow = avgPercent >= 0 ? '▲' : '▼';

	return format(
		'%s 持仓 %s %s% (%d↑ %d↓)',
		arrow,
		stocks.length,
		keepDecimal(avgPercent * 100, 2),
		upCount,
		downCount
	);
}

function getSummaryTooltip(stocks: Stock[]) {
	if (stocks.length === 0) return '点击查看股票详情';

	const lines = ['股票行情概览 (点击查看详情)', ''];
	for (const stock of stocks) {
		const sign = stock.percent >= 0 ? '+' : '';
		lines.push(format(
			'%s: %s (%s%%)',
			stock.name || stock.code,
			keepDecimal(stock.price, calcFixedNumber(stock)),
			sign + keepDecimal(stock.percent * 100, 2),
		));
	}
	return lines.join('\n');
}

async function showStockQuickPick(stocks: Stock[]) {
	const items = stocks.map(stock => ({
		label: format(
			'%s %s %s%',
			stock.name || stock.code,
			keepDecimal(stock.price, calcFixedNumber(stock)),
			keepDecimal(stock.percent * 100, 2),
		),
		description: stock.code,
		detail: format('涨跌: %s  昨收: %s', stock.updown, stock.yestclose),
		stock: stock,
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: '选择股票查看详情',
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (selected) {
		vscode.commands.executeCommand('stockbar.webview');
	}
}

function ensureSummaryBarItem(): vscode.StatusBarItem {
	if (!summaryBarItem) {
		summaryBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			1000, // 高优先级，显示在最左边
		);
		summaryBarItem.command = 'stockbar.showStockList';
		summaryBarItem.show();
	}
	return summaryBarItem;
}

function clearIndividualItems() {
	for (const [, item] of stockHub) {
		item.barItem.hide();
		item.barItem.dispose();
	}
	stockHub.clear();
}

export const render = (stocks: Stock[]) => {
	currentStocks = stocks;

	if (stocks.length > SUMMARY_THRESHOLD) {
		// 摘要模式：显示单个汇总项
		clearIndividualItems();

		const summaryItem = ensureSummaryBarItem();
		summaryItem.text = getSummaryText(stocks);
		summaryItem.tooltip = getSummaryTooltip(stocks);
		summaryItem.color = (stocks.length > 0 && stocks.reduce((sum, s) => sum + s.percent, 0) / stocks.length >= 0
			? Configuration.getRiseColor()
			: Configuration.getFallColor()) as string;
	} else {
		// 详细模式：每个股票单独显示
		if (summaryBarItem) {
			summaryBarItem.hide();
			summaryBarItem.dispose();
			summaryBarItem = null;
		}

		const deleted = Array.from(stockHub.keys()).filter(
			(code) => !stocks.some((s: Stock) => s.code === code),
		);
		for (const item of deleted) {
			stockHub.get(item).barItem.hide();
			stockHub.get(item).barItem.dispose();
			stockHub.delete(item);
		}

		const added = stocks.filter((s: Stock) => !stockHub.has(s.code));
		for (const item of added) {
			const barItem = vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Left,
			);
			stockHub.set(item.code, { barItem });
			barItem.show();
		}

		for (const stock of stocks) {
			const barItem = stockHub.get(stock.code);
			if (barItem) {
				barItem.barItem.text = getItemText(stock);
				barItem.barItem.color = getItemColor(stock);
				barItem.barItem.tooltip = getTooltipText(stock);
			}
		}
	}
};

export function stopAllRender() {
	clearIndividualItems();
	if (summaryBarItem) {
		summaryBarItem.hide();
		summaryBarItem.dispose();
		summaryBarItem = null;
	}
}

export function initRenderCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('stockbar.showStockList', () => {
			showStockQuickPick(currentStocks);
		}),
	);
}