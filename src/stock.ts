import { getCategory, MarketCategory } from './market';

export default class Stock {
	code: string;
	market: string; // 东方财富 secid 市场编码：1=沪市, 0=深市, 116=港股, 105=NASDAQ, 106=NYSE, 107=AMEX
	name: string | null;
	price = 0;
	updown = 0;
	percent = 0;
	high = 0;
	low = 0;
	open = 0;
	yestclose = 0;

	constructor(code: string, market: string) {
		this.code = code;
		this.market = market;
		this.name = null;
	}

	/**
	 * 获取 secid 格式 (市场.代码)
	 */
	getSecid(): string {
		return `${this.market}.${this.code}`;
	}

	/**
	 * 获取市场分类：A股 / 港股 / 美股
	 */
	getCategory(): MarketCategory {
		return getCategory(this.market);
	}

	update(origin: Partial<Stock>) {
		if (origin.name !== undefined) this.name = origin.name;
		if (origin.price !== undefined) this.price = origin.price;
		if (origin.high !== undefined) this.high = origin.high;
		if (origin.low !== undefined) this.low = origin.low;
		if (origin.updown !== undefined) this.updown = origin.updown;
		if (origin.percent !== undefined) this.percent = origin.percent;
		if (origin.open !== undefined) this.open = origin.open;
		if (origin.yestclose !== undefined) this.yestclose = origin.yestclose;
	}
}
