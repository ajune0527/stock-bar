/**
 * 自选股 Tree View
 */

import * as vscode from 'vscode';
import Configuration from '../configuration';
import Stock from '../stock';

type StockNodeType = 'stock' | 'searchResult' | 'action';

export class StockNode extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly nodeType: StockNodeType,
		public readonly stock?: Stock,
		public readonly searchResult?: any,
	) {
		super(label, collapsibleState);
		this.contextValue = nodeType;
	}
}

export class StockTreeDataProvider implements vscode.TreeDataProvider<StockNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<StockNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private stocks: Stock[] = [];

	constructor() {}

	updateStocks(stocks: Stock[]): void {
		this.stocks = stocks;
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

	private getRootChildren(): StockNode[] {
		const nodes: StockNode[] = [];

		for (const stock of this.stocks) {
			const percentStr = stock.percent >= 0
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

		if (this.stocks.length === 0) {
			const emptyNode = new StockNode(
				'暂无自选股，点击上方搜索按钮添加',
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