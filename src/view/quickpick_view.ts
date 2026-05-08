/**
 * Stock Bar - QuickPick 视图
 */

import * as vscode from 'vscode';
import Configuration from '../configuration';
import { eastMoneyProvider, StockSearchResult } from '../eastmoney_provider';
import logger from '../logger';
import Stock from '../stock';

interface StockQuickPickItem extends vscode.QuickPickItem {
	code?: string;
	stock?: Stock;
	searchResult?: StockSearchResult;
}

interface IdentifiableButton extends vscode.QuickInputButton {
	id: string;
}

const TITLE_BUTTON_ID = {
	REFRESH: 'refresh',
	ADD: 'add',
	SETTINGS: 'settings',
} as const;

export class QuickPickView {
	private stocks: Stock[] = [];
	private refreshCallback?: () => void;

	constructor() {}

	onRefresh(callback: () => void): void {
		this.refreshCallback = callback;
	}

	updateStocks(stocks: Stock[]): void {
		this.stocks = stocks;
	}

	async show(): Promise<void> {
		const pick = vscode.window.createQuickPick<StockQuickPickItem>();
		pick.title = '自选股列表';
		pick.placeholder = '输入股票名称或代码搜索添加';
		pick.matchOnDescription = true;
		pick.matchOnDetail = true;
		pick.canSelectMany = false;

		pick.items = this.buildStockItems();
		pick.buttons = this.buildTitleButtons();

		let currentActiveItem: StockQuickPickItem | undefined;
		let searchTimeout: ReturnType<typeof setTimeout> | null = null;

		pick.onDidChangeActive((items) => {
			currentActiveItem = items[0] as StockQuickPickItem;
		});

		pick.onDidChangeValue((value) => {
			if (searchTimeout) {
				clearTimeout(searchTimeout);
			}

			if (!value.trim()) {
				pick.items = this.buildStockItems();
				return;
			}

			pick.busy = true;
			searchTimeout = setTimeout(async () => {
				try {
					const searchItems = await this.searchStocks(value);
					const stockItems = this.buildStockItems();

					if (searchItems.length > 0) {
						pick.items = [
							{ label: '搜索结果', kind: vscode.QuickPickItemKind.Separator },
							...searchItems,
							{ label: '自选股', kind: vscode.QuickPickItemKind.Separator },
							...stockItems,
						];
					} else {
						pick.items = [
							{ label: '无搜索结果', kind: vscode.QuickPickItemKind.Separator },
							{ label: '自选股', kind: vscode.QuickPickItemKind.Separator },
							...stockItems,
						];
					}
				} catch (error) {
					logger.error('搜索失败: %O', error);
				} finally {
					pick.busy = false;
				}
			}, 300);
		});

		pick.onDidAccept(async () => {
			if (!currentActiveItem) return;

			if (currentActiveItem.searchResult) {
				await this.addStockFromSearch(currentActiveItem.searchResult);
				pick.hide();
			} else if (currentActiveItem.stock) {
				pick.hide();
				await this.showStockDetail(currentActiveItem.stock);
			}
		});

		pick.onDidTriggerButton(async (button) => {
			const btn = button as IdentifiableButton;
			pick.hide();
			await this.handleTitleButtonClick(btn.id);
		});

		pick.onDidHide(() => {
			if (searchTimeout) {
				clearTimeout(searchTimeout);
			}
			pick.dispose();
		});

		pick.show();
	}

	private buildStockItems(): StockQuickPickItem[] {
		const items: StockQuickPickItem[] = [];

		if (this.stocks.length === 0) {
			items.push({
				label: '$(info) 暂无自选股',
				description: '输入股票名称或代码搜索添加',
			});
			return items;
		}

		for (const stock of this.stocks) {
			const icon = stock.percent >= 0 ? '$(arrow-up)' : '$(arrow-down)';
			const percentStr = stock.percent >= 0
				? `+${(stock.percent * 100).toFixed(2)}%`
				: `${(stock.percent * 100).toFixed(2)}%`;

			items.push({
				label: `${icon} ${stock.name || stock.code}`,
				description: `${stock.price.toFixed(2)} ${percentStr}`,
				detail: `代码: ${stock.code} | 昨收: ${stock.yestclose.toFixed(2)}`,
				code: stock.code,
				stock,
			});
		}

		return items;
	}

	private async searchStocks(query: string): Promise<StockQuickPickItem[]> {
		try {
			const searchResults = await eastMoneyProvider.search(query);

			return searchResults.map((result) => ({
				label: `$(add) ${result.name}`,
				description: result.code,
				detail: `市场: ${result.securityTypeName} | 点击添加到自选`,
				code: result.code,
				searchResult: result,
			}));
		} catch (error) {
			logger.error('搜索失败: %O', error);
			return [];
		}
	}

	private async showStockDetail(stock: Stock): Promise<void> {
		const pick = vscode.window.createQuickPick<StockQuickPickItem>();
		pick.title = `${stock.name || stock.code} 详情`;
		pick.placeholder = `现价: ${stock.price.toFixed(2)} | 涨跌: ${(stock.percent * 100).toFixed(2)}%`;
		pick.canSelectMany = false;

		const items: StockQuickPickItem[] = [
			{
				label: '$(trash) 从自选中删除',
				description: stock.name || stock.code,
				stock,
			},
			{
				label: '$(arrow-left) 返回列表',
			},
		];

		pick.items = items;

		pick.onDidAccept(async () => {
			const selectedItem = pick.selectedItems[0];
			if (!selectedItem) return;

			pick.hide();

			if (selectedItem.stock) {
				await this.removeStock(selectedItem.stock);
			} else {
				await this.show();
			}
		});

		pick.onDidHide(() => pick.dispose());
		pick.show();
	}

	private async addStockFromSearch(result: StockSearchResult): Promise<void> {
		const code = result.code;
		const market = result.market ;

		const currentStocks = Configuration.getStocks() || [];
		const exists = currentStocks.some(
			(item) => item.code === code,
		);

		if (exists) {
			vscode.window.showInformationMessage(`股票 ${result.name} (${code}) 已存在！`);
			return;
		}

		currentStocks.push({ code, market });

		await Configuration.stockBarConfig().update(
			'stocks',
			currentStocks,
			vscode.ConfigurationTarget.Global,
		);

		vscode.window.showInformationMessage(`已添加：${result.name} (${code})`);
		this.refreshCallback?.();
	}

	private async removeStock(stock: Stock): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			`确定要从自选中删除 ${stock.name || stock.code} 吗？`,
			'确定',
			'取消',
		);

		if (confirm !== '确定') return;

		const currentStocks = Configuration.getStocks() || [];
		const newStocks = currentStocks.filter(
			(item) => item.code !== stock.code,
		);

		await Configuration.stockBarConfig().update(
			'stocks',
			newStocks,
			vscode.ConfigurationTarget.Global,
		);

		vscode.window.showInformationMessage(`已删除：${stock.name || stock.code}`);
		this.refreshCallback?.();
	}

	private buildTitleButtons(): vscode.QuickInputButton[] {
		return [
			{
				iconPath: new vscode.ThemeIcon('refresh'),
				tooltip: '刷新数据',
			} as IdentifiableButton,
			{
				iconPath: new vscode.ThemeIcon('add'),
				tooltip: '添加股票',
			} as IdentifiableButton,
			{
				iconPath: new vscode.ThemeIcon('settings-gear'),
				tooltip: '打开设置',
			} as IdentifiableButton,
		];
	}

	private async handleTitleButtonClick(buttonId: string): Promise<void> {
		switch (buttonId) {
			case TITLE_BUTTON_ID.REFRESH:
				this.refreshCallback?.();
				vscode.window.showInformationMessage('数据已刷新');
				break;
			case TITLE_BUTTON_ID.ADD:
				await this.showAddDialog();
				break;
			case TITLE_BUTTON_ID.SETTINGS:
				vscode.commands.executeCommand('workbench.action.openSettings', 'stock-bar');
				break;
		}
	}

	private async showAddDialog(): Promise<void> {
		const input = await vscode.window.showInputBox({
			prompt: '输入股票名称或代码',
		});

		if (!input?.trim()) return;

		try {
			const searchResults = await eastMoneyProvider.search(input.trim());

			if (searchResults.length === 0) {
				vscode.window.showWarningMessage('未找到相关股票');
				return;
			}

			const items = searchResults.map((result) => ({
				label: result.name,
				description: result.code,
				detail: `市场: ${result.securityTypeName}`,
				searchResult: result,
			}));

			const selected = await vscode.window.showQuickPick(items, {
				title: '选择要添加的股票',
				placeHolder: '搜索结果',
			});

			if (selected?.searchResult) {
				await this.addStockFromSearch(selected.searchResult);
			}
		} catch (error) {
			logger.error('搜索失败: %O', error);
			vscode.window.showErrorMessage('搜索失败，请重试');
		}
	}
}