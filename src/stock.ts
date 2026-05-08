export default class Stock {
	code: string;
	market: string; // 1=沪市, 0=深市
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
		this.market = market
		this.name = null;
	}

	/**
	 * 获取 secid 格式 (市场.代码)
	 */
	getSecid(): string {
		return `${this.market}.${this.code}`;
	}

	update(origin: Partial<Stock>) {
		this.name = origin.name || null;
		this.price = origin.price || 0;
		this.high = origin.high || 0;
		this.low = origin.low || 0;
		this.updown = origin.updown || 0;
		this.percent = origin.percent || 0;
		this.open = origin.open || 0;
		this.yestclose = origin.yestclose || 0;
	}
}
