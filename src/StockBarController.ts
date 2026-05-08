import * as vscode from 'vscode';
import Configuration from './configuration';
import { eastMoneyProvider, StockSearchResult } from './eastmoney_provider';
import logger from './logger';
import { render, stopAllRender } from './render';
import Stock from './stock';
import { QuickPickView } from './view/quickpick_view';
import { StockTreeDataProvider } from './view/stockTree';
import { StockWebView } from './view/webview';

export default class StockBarController {
	private timer: ReturnType<typeof setInterval> | null = null;
	private stocks: Stock[] = [];
	private quickPickView: QuickPickView;
	private treeDataProvider: StockTreeDataProvider;
	private webView: StockWebView;

	constructor() {
		this.stocks = this.loadChoiceStocks();
		this.quickPickView = new QuickPickView();
		this.treeDataProvider = new StockTreeDataProvider();
		this.webView = new StockWebView();
		this.quickPickView.onRefresh(() => this.restart());
		this.webView.onRefresh(() => this.restart());
	}

	private loadChoiceStocks(): Stock[] {
		return Configuration.getStocks().map((item) => {
			return new Stock(item.code, item.market);
		});
	}

	private isTradingTime(): boolean {
		const now = new Date();
		// 使用上海时区获取时间
		const shanghaiTime = new Intl.DateTimeFormat('zh-CN', {
			timeZone: 'Asia/Shanghai',
			hour: 'numeric',
			minute: 'numeric',
			weekday: 'short',
			hour12: false,
		}).formatToParts(now);

		const parts = Object.fromEntries(shanghaiTime.map(p => [p.type, p.value]));
		const day = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].indexOf(parts.weekday);
		// 周末不交易
		if (day === 0 || day === 6) {
			return false;
		}

		const hour = parseInt(parts.hour, 10);
		const minute = parseInt(parts.minute, 10);
		const time = hour * 60 + minute;

		// 上午 9:30 - 11:30
		const morningStart = 9 * 60 + 30;
		const morningEnd = 11 * 60 + 30;
		// 下午 13:00 - 15:00
		const afternoonStart = 13 * 60;
		const afternoonEnd = 15 * 60;

		return (time >= morningStart && time <= morningEnd) ||
			   (time >= afternoonStart && time <= afternoonEnd);
	}

	private async ticker(): Promise<void> {
		// 非交易时间不请求新数据
		if (!this.isTradingTime()) {
			logger.debug('非交易时间，跳过数据请求');
			return;
		}

		try {
			logger.debug('call fetchData');
			const secids = this.stocks.map((s) => s.getSecid());
			const stockData = await eastMoneyProvider.fetch(secids);

			stockData.forEach((data) => {
				const stock = this.stocks.find(
					(s) => s.code.toLowerCase() === data.code?.toLowerCase(),
				);
				if (stock && data) {
					stock.update(data as Stock);
				}
			});

			logger.debug('render');
			render(this.stocks);

			this.quickPickView.updateStocks(this.stocks);
			this.treeDataProvider.updateStocks(this.stocks);
			this.webView.updateStocks(this.stocks);
		} catch (error) {
			logger.error('%O', error);
		}
	}

	public openStockList(): void {
		this.quickPickView.show();
	}

	public async openSearch(): Promise<void> {
		const input = await vscode.window.showInputBox({
			prompt: '输入股票名称或代码搜索',
		});

		if (input?.trim()) {
			await this.searchAndAdd(input.trim());
		}
	}

	private async searchAndAdd(query: string): Promise<void> {
		try {
			const searchResults = await eastMoneyProvider.search(query);

			if (searchResults.length === 0) {
				vscode.window.showWarningMessage('未找到相关股票');
				return;
			}

			const items = searchResults.map((result) => ({
				label: result.name,
				description: result.code,
				detail: '市场: ' + result.securityTypeName,
				result,
			}));

			const selected = await vscode.window.showQuickPick(items, {
				title: '选择要添加的股票',
				placeHolder: '搜索结果',
			});

			if (selected) {
				await this.addStock(selected.result);
			}
		} catch (error) {
			logger.error('搜索失败: %O', error);
			vscode.window.showErrorMessage('搜索失败，请重试');
		}
	}

	private async addStock(result: StockSearchResult): Promise<void> {
		const code = result.code;
		const market = result.market;

		const currentStocks = Configuration.getStocks() || [];
		const exists = currentStocks.some(
			(item) => item.code === code,
		);

		if (exists) {
			vscode.window.showInformationMessage('股票 ' + result.name + ' (' + code + ') 已存在！');
			return;
		}

		currentStocks.push({ code, market });

		await Configuration.stockBarConfig().update(
			'stocks',
			currentStocks,
			vscode.ConfigurationTarget.Global,
		);

		vscode.window.showInformationMessage('已添加：' + result.name + ' (' + code + ')');
		this.restart();
	}

	private getMarketName(market: string): string {
		const marketMap: Record<string, string> = {
			'1': '沪市A股',
			'0': '深市A股',
		};
		return marketMap[market] || market;
	}

	public restart(): void {
		const interval = Configuration.getUpdateInterval();
		if (this.timer) clearInterval(this.timer);
		this.stocks = this.loadChoiceStocks();
		this.timer = setInterval(() => this.ticker(), interval);
		this.ticker();
	}

	public stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		stopAllRender();
	}

	public registerCommands(context: vscode.ExtensionContext): void {
		const treeView = vscode.window.createTreeView('stockBarList', {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: false,
		});

		context.subscriptions.push(
			treeView,
			vscode.commands.registerCommand('stockbar.start', () => this.restart()),
			vscode.commands.registerCommand('stockbar.stop', () => this.stop()),
			vscode.commands.registerCommand('stockbar.add', () => this.openSearch()),
			vscode.commands.registerCommand('stockbar.list', () => this.openStockList()),
			vscode.commands.registerCommand('stockbar.webview', () => this.webView.show()),
			vscode.commands.registerCommand('stockbar.refresh', () => {
				this.restart();
				vscode.window.showInformationMessage('数据已刷新');
			}),
			vscode.commands.registerCommand('stockbar.treeItem.remove', (node) => {
				if (node?.stock) {
					this.removeStock(node.stock);
				}
			}),
			vscode.commands.registerCommand('stockbar.treeItem.add', (node) => {
				if (node?.searchResult) {
					this.addStock(node.searchResult);
				}
			}),
			// 排序命令
			vscode.commands.registerCommand('stockbar.treeItem.moveUp', (node) => {
				if (node?.stock) {
					this.moveStock(node.stock, 'up');
				}
			}),
			vscode.commands.registerCommand('stockbar.treeItem.moveDown', (node) => {
				if (node?.stock) {
					this.moveStock(node.stock, 'down');
				}
			}),
			vscode.commands.registerCommand('stockbar.treeItem.moveTop', (node) => {
				if (node?.stock) {
					this.moveStock(node.stock, 'top');
				}
			}),
			vscode.commands.registerCommand('stockbar.treeItem.moveBottom', (node) => {
				if (node?.stock) {
					this.moveStock(node.stock, 'bottom');
				}
			}),
			vscode.workspace.onDidChangeConfiguration(() => {
				if (this.timer) this.restart();
			}),
		);

		this.restart();
	}

	private async removeStock(stock: Stock): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			'确定要从自选中删除 ' + (stock.name || stock.code) + ' 吗？',
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

		vscode.window.showInformationMessage('已删除：' + (stock.name || stock.code));
		this.restart();
	}

	private async moveStock(stock: Stock, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void> {
		const currentStocks = Configuration.getStocks() || [];
		const currentIndex = currentStocks.findIndex(item => item.code === stock.code);

		if (currentIndex === -1) return;

		const newStocks = [...currentStocks];
		newStocks.splice(currentIndex, 1);

		let newIndex: number;
		switch (direction) {
			case 'up':
				newIndex = Math.max(0, currentIndex - 1);
				break;
			case 'down':
				newIndex = Math.min(newStocks.length, currentIndex + 1);
				break;
			case 'top':
				newIndex = 0;
				break;
			case 'bottom':
				newIndex = newStocks.length;
				break;
		}

		newStocks.splice(newIndex, 0, currentStocks[currentIndex]);

		await Configuration.stockBarConfig().update(
			'stocks',
			newStocks,
			vscode.ConfigurationTarget.Global,
		);

		this.restart();
	}

	public dispose(): void {
		this.stop();
	}
}