import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import {
	fetchAxDataTrends,
	toAxDataInstrumentFromSecid,
} from '../axdata_quote_provider';
import Configuration from '../configuration';
import Stock from '../stock';
import {
	toTrendStockSnapshot,
	TrendSelectionModel,
	TrendViewState,
} from '../trend_selection_model';
import { getStockTrendHtml } from './stockTrendHtml';

export class StockTrendViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	private readonly model = new TrendSelectionModel(
		(secid) => {
			const instrument = toAxDataInstrumentFromSecid(secid);
			if (!instrument) {
				throw new Error('AxData 暂不支持该市场的分时数据');
			}
			return fetchAxDataTrends(
				Configuration.getAxDataWebSocketUrl(),
				Configuration.getAxDataToken(),
				instrument,
			);
		},
		(state) => this.postState(state),
	);

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
		};
		webviewView.webview.html = getStockTrendHtml(
			webviewView.webview.cspSource,
			randomBytes(16).toString('base64'),
		);
		webviewView.webview.onDidReceiveMessage((message) => {
			if (message?.command === 'refresh') {
				this.model.refresh();
			} else if (message?.command === 'ready') {
				this.postState(this.model.currentState());
			}
		});
		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	showStock(stock: Stock): void {
		this.model.select(toTrendStockSnapshot(stock));
	}

	syncStocks(stocks: readonly Stock[]): void {
		this.model.syncStocks(stocks.map(toTrendStockSnapshot));
	}

	private postState(state: TrendViewState): void {
		void this.view?.webview.postMessage({
			type: 'trendState',
			state,
		});
	}
}
