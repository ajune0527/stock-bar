/**
 * 自选股 Tree View
 */

import * as vscode from 'vscode';
import Configuration from '../configuration';
import { TABS, TabId } from '../market';
import Stock from '../stock';

type StockNodeType = 'stock' | 'searchResult' | 'action' | 'tab';

const STOCK_MIME_TYPE = 'application/vnd.code.tree.stockBarList';

export class StockNode extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly nodeType: StockNodeType,
		public readonly stock?: Stock,
		public readonly searchResult?: any,
		public readonly tabId?: TabId,
	) {
		super(label, collapsibleState);
		this.contextValue = nodeType;
	}
}

export class StockTreeDataProvider
	implements
		vscode.TreeDataProvider<StockNode>,
		vscode.TreeDragAndDropController<StockNode>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		StockNode | undefined | null | void
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	readonly dragMimeTypes = [STOCK_MIME_TYPE];
	readonly dropMimeTypes = [STOCK_MIME_TYPE];

	private stocks: Stock[] = [];
	private activeTab: TabId = 'all';
	private onReorder?: () => void;

	constructor() {}

	onDropCallback?: (source: StockNode, target: StockNode) => void;

	setOnReorder(callback: () => void): void {
		this.onReorder = callback;
	}

	updateStocks(stocks: Stock[], activeTab: TabId): void {
		this.stocks = stocks;
		this.activeTab = activeTab;
		this._onDidChangeTreeData.fire();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: StockNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: StockNode): vscode.ProviderResult<StockNode[]> {
		if (!element) {
			return this.getRootChildren();
		}
		return [];
	}

	async handleDrag(
		source: readonly StockNode[],
		dataTransfer: vscode.DataTransfer,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const stock = source[0]?.stock;
		if (!stock) return;
		dataTransfer.set(STOCK_MIME_TYPE, new vscode.DataTransferItem(stock.code));
	}

	async handleDrop(
		target: StockNode | undefined,
		dataTransfer: vscode.DataTransfer,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const transferItem = dataTransfer.get(STOCK_MIME_TYPE);
		if (!transferItem) return;

		const sourceCode = transferItem.value as string;
		const targetCode = target?.stock?.code;
		if (!targetCode || sourceCode === targetCode) return;

		const currentStocks = Configuration.getStocks();
		const sourceIndex = currentStocks.findIndex(
			(item) => item.code === sourceCode,
		);
		const targetIndex = currentStocks.findIndex(
			(item) => item.code === targetCode,
		);
		if (sourceIndex === -1 || targetIndex === -1) return;

		const [moved] = currentStocks.splice(sourceIndex, 1);
		currentStocks.splice(targetIndex, 0, moved);

		await Configuration.stockBarConfig().update(
			'stocks',
			currentStocks,
			vscode.ConfigurationTarget.Global,
		);
		this.onReorder?.();
	}

	private getRootChildren(): StockNode[] {
		const nodes: StockNode[] = [];

		// 顶部 Tab 节点：全部 / A股 / 港股 / 美股
		for (const tab of TABS) {
			const isActive = this.activeTab === tab.id;
			const node = new StockNode(
				`${tab.label}`,
				vscode.TreeItemCollapsibleState.None,
				'tab',
				undefined,
				undefined,
				tab.id,
			);
			node.iconPath = new vscode.ThemeIcon(isActive ? 'checkmark' : 'dash');
			node.description = isActive ? '当前' : '';
			node.command = {
				command: 'stockbar.switchTab',
				title: `切换到 ${tab.label}`,
				arguments: [tab.id],
			};
			nodes.push(node);
		}

		// 股票列表（由控制器按 Tab 过滤后传入）
		for (const stock of this.stocks) {
			const percentStr =
				stock.percent >= 0
					? `+${(stock.percent * 100).toFixed(2)}%`
					: `${(stock.percent * 100).toFixed(2)}%`;
			const icon = stock.percent >= 0 ? 'arrow-up' : 'arrow-down';

			const node = new StockNode(
				`${stock.name || stock.code}`,
				vscode.TreeItemCollapsibleState.None,
				'stock',
				stock,
			);
			node.iconPath = new vscode.ThemeIcon(icon);
			node.description = `${stock.price.toFixed(2)} ${percentStr}`;
			node.tooltip = this.buildTooltip(stock);
			nodes.push(node);
		}

		// 分类下无股票的空状态
		if (this.stocks.length === 0) {
			const currentTabLabel =
				TABS.find((t) => t.id === this.activeTab)?.label ?? '全部';
			const emptyNode = new StockNode(
				`当前分类（${currentTabLabel}）暂无股票`,
				vscode.TreeItemCollapsibleState.None,
				'action',
			);
			emptyNode.iconPath = new vscode.ThemeIcon('info');
			nodes.push(emptyNode);
		}

		return nodes;
	}

	private buildTooltip(stock: Stock): string {
		const lines = [
			`【${stock.name || stock.code}】`,
			`代码: ${stock.code}`,
			`现价: ${stock.price.toFixed(2)}`,
			`涨跌: ${(stock.percent * 100).toFixed(2)}%`,
			`昨收: ${stock.yestclose.toFixed(2)}`,
		];
		return lines.join('\n');
	}
}
