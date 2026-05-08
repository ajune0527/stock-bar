import { format } from 'util';
import * as vscode from 'vscode';
import Configuration from './configuration';
import Stock from './stock';
import { calcFixedNumber, keepDecimal } from './utils';

const stockHub = new Map();

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

export const render = (stocks: any) => {
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
};

export function stopAllRender() {
	for (const [, item] of stockHub) {
		const barItem = item.barItem;
		barItem.hide();
		barItem.dispose();
	}
	stockHub.clear();
}