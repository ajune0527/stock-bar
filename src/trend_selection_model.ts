import type { TrendData } from './eastmoney_provider';
import type { MarketCategory } from './market';
import type Stock from './stock';

export interface TrendStockSnapshot {
	code: string;
	market: string;
	name: string;
	price: number;
	updown: number;
	percent: number;
	yestclose: number;
	category: MarketCategory;
}

export type TrendViewStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface TrendViewState {
	status: TrendViewStatus;
	stock: TrendStockSnapshot | null;
	trends: readonly TrendData[];
	error?: string;
}

export function toTrendStockSnapshot(stock: Stock): TrendStockSnapshot {
	return {
		code: stock.code,
		market: stock.market,
		name: stock.name || stock.code,
		price: stock.price,
		updown: stock.updown,
		percent: stock.percent,
		yestclose: stock.yestclose,
		category: stock.getCategory(),
	};
}

type FetchTrends = (secid: string) => Promise<TrendData[]>;
type StateListener = (state: TrendViewState) => void;

function stockKey(stock: Pick<TrendStockSnapshot, 'code' | 'market'>): string {
	return `${stock.market}.${stock.code}`;
}

export class TrendSelectionModel {
	private selected: TrendStockSnapshot | null = null;
	private generation = 0;
	private state: TrendViewState = {
		status: 'empty',
		stock: null,
		trends: [],
	};

	constructor(
		private readonly fetchTrends: FetchTrends,
		private readonly onState: StateListener,
	) {}

	select(stock: TrendStockSnapshot): void {
		this.selected = stock;
		this.generation += 1;
		const generation = this.generation;
		this.emit({
			status: 'loading',
			stock,
			trends: [],
		});
		void this.load(stockKey(stock), stock, generation);
	}

	refresh(): void {
		if (!this.selected) {
			return;
		}
		this.select(this.selected);
	}

	syncStocks(stocks: readonly TrendStockSnapshot[]): void {
		if (!this.selected) {
			return;
		}
		const selected = stocks.find(
			(stock) =>
				stock.code === this.selected?.code &&
				stock.market === this.selected?.market,
		);
		if (!selected) {
			this.generation += 1;
			this.selected = null;
			this.emit({
				status: 'empty',
				stock: null,
				trends: [],
			});
			return;
		}
		this.selected = selected;
		this.emit({
			...this.state,
			stock: selected,
		});
	}

	currentState(): TrendViewState {
		return this.state;
	}

	private async load(
		key: string,
		stock: TrendStockSnapshot,
		generation: number,
	): Promise<void> {
		try {
			const trends = await this.fetchTrends(key);
			if (
				generation !== this.generation ||
				!this.selected ||
				stockKey(this.selected) !== key
			) {
				return;
			}
			this.emit({
				status: 'ready',
				stock: this.selected,
				trends,
			});
		} catch (error) {
			if (
				generation !== this.generation ||
				!this.selected ||
				stockKey(this.selected) !== key
			) {
				return;
			}
			this.emit({
				status: 'error',
				stock: this.selected,
				trends: [],
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private emit(state: TrendViewState): void {
		this.state = state;
		this.onState(state);
	}
}
