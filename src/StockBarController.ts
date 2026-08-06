import * as vscode from 'vscode';
import {
	AxDataQuoteProvider,
	fetchAxDataStockNames,
	selectEastMoneyFallbackStocks,
	toAxDataInstrument,
} from './axdata_quote_provider';
import Configuration from './configuration';
import { eastMoneyProvider, StockSearchResult } from './eastmoney_provider';
import logger from './logger';
import { getMarketName, isAnyTrading, MarketCategory, TabId } from './market';
import { render, stopAllRender, initRenderCommands } from './render';
import Stock from './stock';
import { QuickPickView } from './view/quickpick_view';
import { StockTrendViewProvider } from './view/stockTrendView';
import { StockTreeDataProvider } from './view/stockTree';
import { StockWebView } from './view/webview';

const ACTIVE_TAB_STATE_KEY = 'stockBar.activeTab';

export default class StockBarController {
	private timer: ReturnType<typeof setInterval> | null = null;
	private stocks: Stock[] = [];
	private quickPickView: QuickPickView;
	private treeDataProvider: StockTreeDataProvider;
	private webView: StockWebView;
	private readonly trendView: StockTrendViewProvider;
	private context: vscode.ExtensionContext | null = null;
	private activeTab: TabId = 'all';
	private readonly axDataQuoteProvider: AxDataQuoteProvider;
	private feedGeneration = 0;

	constructor() {
		this.stocks = this.loadChoiceStocks();
		this.axDataQuoteProvider = new AxDataQuoteProvider();
		this.quickPickView = new QuickPickView();
		this.treeDataProvider = new StockTreeDataProvider();
		this.treeDataProvider.setOnReorder(() => this.restart());
		this.webView = new StockWebView();
		this.trendView = new StockTrendViewProvider();
		this.quickPickView.onRefresh(() => this.restart());
		this.webView.onRefresh(() => this.restart());
	}

	private loadChoiceStocks(): Stock[] {
		return Configuration.getStocks().map((item) => {
			return new Stock(item.code, item.market);
		});
	}

	private isTradingTime(stocks: readonly Stock[] = this.stocks): boolean {
		if (stocks.length === 0) {
			return false;
		}
		// 持仓中任一市场（A股/港股/美股）处于交易时间即刷新
		const categories = new Set<MarketCategory>();
		for (const stock of stocks) {
			categories.add(stock.getCategory());
		}
		if (isAnyTrading(categories)) {
			return true;
		}
		logger.debug('非交易时间，跳过数据请求');
		return false;
	}

	private async ticker(generation = this.feedGeneration): Promise<void> {
		if (generation !== this.feedGeneration) {
			return;
		}
		const fallbackStocks = selectEastMoneyFallbackStocks(
			this.stocks,
			this.axDataQuoteProvider.isConnected(),
			this.axDataQuoteProvider.coveredCodes(),
		);
		if (fallbackStocks.length === 0) {
			return;
		}
		// 非交易时间不请求新数据
		if (!this.isTradingTime(fallbackStocks)) {
			logger.debug('非交易时间，跳过数据请求');
			return;
		}

		await this.fetchEastMoneyQuotes(fallbackStocks, generation);
	}

	private async fetchEastMoneyQuotes(
		stocks: readonly Stock[],
		generation: number,
	): Promise<void> {
		try {
			logger.debug('call fetchData');
			const secids = stocks.map((s) => s.getSecid());
			const stockData = await eastMoneyProvider.fetch(secids);
			if (generation !== this.feedGeneration) {
				return;
			}

			stockData.forEach((data) => {
				const stock = stocks.find(
					(s) => s.code.toLowerCase() === data.code?.toLowerCase(),
				);
				if (stock && data) {
					const axDataOwnsQuote =
						toAxDataInstrument(stock) !== null &&
						this.axDataQuoteProvider.isConnected() &&
						this.axDataQuoteProvider
							.coveredCodes()
							.has(stock.code.toLowerCase());
					stock.update(
						axDataOwnsQuote ? { name: data.name } : (data as Partial<Stock>),
					);
				}
			});

			this.applyRender();
		} catch (error) {
			logger.error('%O', error);
		}
	}

	private startAxData(generation: number): void {
		const instruments = this.stocks
			.map((stock) => toAxDataInstrument(stock))
			.filter((instrument): instrument is string => instrument !== null);
		if (instruments.length === 0) {
			return;
		}

		this.axDataQuoteProvider.start({
			url: Configuration.getAxDataWebSocketUrl(),
			token: Configuration.getAxDataToken(),
			instruments,
			intervalMs: Configuration.getUpdateInterval(),
			onQuotes: (updates) => {
				if (generation !== this.feedGeneration) {
					return;
				}
				for (const update of updates) {
					const stock = this.stocks.find(
						(item) =>
							toAxDataInstrument(item) !== null &&
							item.code.toLowerCase() === update.code?.toLowerCase(),
					);
					if (stock) {
						stock.update(update);
					}
				}
				this.applyRender();
			},
			onStateChange: (connected) => {
				if (generation !== this.feedGeneration) {
					return;
				}
				logger.debug(connected ? 'AxData 行情已连接' : 'AxData 行情已断开');
				if (!connected) {
					void this.ticker(generation);
				}
			},
			onError: (error) => {
				if (generation === this.feedGeneration) {
					logger.error('AxData 行情错误: %s', error.message);
				}
			},
		});
	}

	private async loadAxDataStockNames(generation: number): Promise<void> {
		const instruments = this.stocks
			.map((stock) => toAxDataInstrument(stock))
			.filter((instrument): instrument is string => instrument !== null);
		try {
			const names = await fetchAxDataStockNames(
				Configuration.getAxDataWebSocketUrl(),
				Configuration.getAxDataToken(),
				instruments,
			);
			if (generation !== this.feedGeneration) {
				return;
			}
			for (const update of names) {
				const stock = this.stocks.find(
					(item) => toAxDataInstrument(item) === update.instrumentId,
				);
				stock?.update({ name: update.name });
			}
			this.applyRender();
		} catch (error) {
			logger.error('AxData 股票名称加载失败: %O', error);
		}
	}

	/**
	 * 过滤当前 Tab 下的股票
	 */
	private getFilteredStocks(): Stock[] {
		if (this.activeTab === 'all') {
			return this.stocks;
		}
		return this.stocks.filter((s) => s.getCategory() === this.activeTab);
	}

	/**
	 * 用当前已拉取的数据渲染所有视图（按当前 Tab 过滤）
	 */
	private applyRender(): void {
		const filtered = this.getFilteredStocks();
		logger.debug('render');
		render(filtered);
		this.quickPickView.updateStocks(filtered);
		this.treeDataProvider.updateStocks(filtered, this.activeTab);
		this.webView.updateStocks(filtered);
		this.trendView.syncStocks(this.stocks);
	}

	/**
	 * 切换分类 Tab
	 */
	public switchTab(tab: TabId): void {
		if (this.activeTab === tab) {
			return;
		}
		this.activeTab = tab;
		this.context?.globalState.update(ACTIVE_TAB_STATE_KEY, tab);
		this.applyRender();
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
		const exists = currentStocks.some((item) => item.code === code);

		if (exists) {
			vscode.window.showInformationMessage(
				'股票 ' + result.name + ' (' + code + ') 已存在！',
			);
			return;
		}

		currentStocks.push({ code, market });

		await Configuration.stockBarConfig().update(
			'stocks',
			currentStocks,
			vscode.ConfigurationTarget.Global,
		);

		vscode.window.showInformationMessage(
			'已添加：' + result.name + ' (' + code + ')',
		);
		this.restart();
	}

	private getMarketName(market: string): string {
		return getMarketName(market);
	}

	public restart(): void {
		const interval = Configuration.getUpdateInterval();
		this.feedGeneration += 1;
		const generation = this.feedGeneration;
		if (this.timer) clearInterval(this.timer);
		this.axDataQuoteProvider.stop();
		this.stocks = this.loadChoiceStocks();
		this.applyRender();
		this.startAxData(generation);
		void this.loadAxDataStockNames(generation);
		void this.fetchEastMoneyQuotes(this.stocks, generation);
		this.timer = setInterval(() => void this.ticker(generation), interval);
	}

	public stop(): void {
		this.feedGeneration += 1;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.axDataQuoteProvider.stop();
		stopAllRender();
	}

	public registerCommands(context: vscode.ExtensionContext): void {
		this.context = context;
		this.activeTab =
			context.globalState.get<TabId>(ACTIVE_TAB_STATE_KEY) ?? 'all';

		const treeView = vscode.window.createTreeView('stockBarList', {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: false,
			dragAndDropController: this.treeDataProvider,
		});
		const trendViewRegistration = vscode.window.registerWebviewViewProvider(
			'stockBarTrend',
			this.trendView,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			},
		);
		const treeSelection = treeView.onDidChangeSelection((event) => {
			const node = event.selection[0];
			if (node?.nodeType === 'stock' && node.stock) {
				this.trendView.showStock(node.stock);
			}
		});

		initRenderCommands(context);

		context.subscriptions.push(
			treeView,
			trendViewRegistration,
			treeSelection,
			vscode.commands.registerCommand('stockbar.start', () => this.restart()),
			vscode.commands.registerCommand('stockbar.stop', () => this.stop()),
			vscode.commands.registerCommand('stockbar.add', () => this.openSearch()),
			vscode.commands.registerCommand('stockbar.list', () =>
				this.openStockList(),
			),
			vscode.commands.registerCommand('stockbar.webview', () =>
				this.webView.show(),
			),
			vscode.commands.registerCommand('stockbar.switchTab', (tab: TabId) =>
				this.switchTab(tab),
			),
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
			vscode.commands.registerCommand(
				'stockbar.treeItem.moveBottom',
				(node) => {
					if (node?.stock) {
						this.moveStock(node.stock, 'bottom');
					}
				},
			),
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
		const newStocks = currentStocks.filter((item) => item.code !== stock.code);

		await Configuration.stockBarConfig().update(
			'stocks',
			newStocks,
			vscode.ConfigurationTarget.Global,
		);

		vscode.window.showInformationMessage(
			'已删除：' + (stock.name || stock.code),
		);
		this.restart();
	}

	private async moveStock(
		stock: Stock,
		direction: 'up' | 'down' | 'top' | 'bottom',
	): Promise<void> {
		const currentStocks = Configuration.getStocks() || [];
		const currentIndex = currentStocks.findIndex(
			(item) => item.code === stock.code,
		);

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
