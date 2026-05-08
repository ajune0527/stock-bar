import * as vscode from 'vscode';

/**
 * 股票配置项
 */
export interface StockConfig {
	code: string;
	market: string; // 1=沪市, 0=深市
}

export default class Configuration {
	static stockBarConfig() {
		return vscode.workspace.getConfiguration('stock-bar');
	}

	static getStocks(): StockConfig[] {
		const stocks = Configuration.stockBarConfig().get('stocks');
		if (!stocks || !Array.isArray(stocks)) {
			return [];
		}
		return stocks as StockConfig[];
	}

	static getUpdateInterval() {
		const updateInterval = Configuration.stockBarConfig().get('updateInterval');
		return typeof updateInterval === 'number' ? updateInterval : 10000;
	}

	static getRiseColor() {
		return Configuration.stockBarConfig().get('riseColor');
	}

	static getFallColor() {
		return Configuration.stockBarConfig().get('fallColor');
	}
}
