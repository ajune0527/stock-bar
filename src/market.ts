/**
 * 市场分类与交易时间抽象
 * 基于东方财富 secid 体系：secid 格式为 `${market}.${code}`
 */

export type MarketCategory = 'A' | 'HK' | 'US';

export interface MarketInfo {
	category: MarketCategory;
	name: string;
}

export type TabId = 'all' | MarketCategory;

export interface TabDef {
	id: TabId;
	label: string;
}

interface MarketWindow {
	timeZone: string;
	// 交易时段区间（分钟），可有多段
	sessions: Array<{ start: number; end: number }>;
}

/** 各分类的交易时间窗口 */
const TRADING_WINDOWS: Record<MarketCategory, MarketWindow> = {
	A: {
		timeZone: 'Asia/Shanghai',
		sessions: [
			{ start: 9 * 60 + 30, end: 11 * 60 + 30 }, // 9:30 - 11:30
			{ start: 13 * 60, end: 15 * 60 }, // 13:00 - 15:00
		],
	},
	HK: {
		timeZone: 'Asia/Hong_Kong',
		sessions: [
			{ start: 9 * 60 + 30, end: 12 * 60 }, // 9:30 - 12:00
			{ start: 13 * 60, end: 16 * 60 }, // 13:00 - 16:00
		],
	},
	US: {
		timeZone: 'America/New_York',
		sessions: [
			{ start: 9 * 60 + 30, end: 16 * 60 }, // 9:30 - 16:00
		],
	},
};

/** 东方财富 secid market 编码 -> 分类/名称 */
const MARKET_MAP: Record<string, MarketInfo> = {
	'1': { category: 'A', name: '沪市A股' },
	'0': { category: 'A', name: '深市A股' },
	'116': { category: 'HK', name: '港股' },
	'105': { category: 'US', name: '美股(NASDAQ)' },
	'106': { category: 'US', name: '美股(NYSE)' },
	'107': { category: 'US', name: '美股(AMEX)' },
};

/** Tab 列表 */
export const TABS: TabDef[] = [
	{ id: 'all', label: '全部' },
	{ id: 'A', label: 'A股' },
	{ id: 'HK', label: '港股' },
	{ id: 'US', label: '美股' },
];

/** 根据 secid market 编码获取分类 */
export function getCategory(market: string): MarketCategory {
	return MARKET_MAP[market]?.category ?? 'A';
}

/** 根据 secid market 编码获取市场名称 */
export function getMarketName(market: string): string {
	return MARKET_MAP[market]?.name ?? market;
}

/** 获取某分类在指定时刻是否处于交易时间 */
export function isTrading(
	category: MarketCategory,
	now: Date = new Date(),
): boolean {
	const window = TRADING_WINDOWS[category];
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: window.timeZone,
		hour: 'numeric',
		minute: 'numeric',
		weekday: 'short',
		hour12: false,
	}).formatToParts(now);

	const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	const weekday = map.weekday;

	// 仅周一至周五交易
	const weekend = ['Sat', 'Sun'];
	if (weekend.includes(weekday)) {
		return false;
	}

	const hour = parseInt(map.hour, 10);
	const minute = parseInt(map.minute, 10);
	const time = hour * 60 + minute;

	return window.sessions.some((s) => time >= s.start && time <= s.end);
}

/** 持仓中任一市场分类处于交易时间即返回 true */
export function isAnyTrading(
	categories: Set<MarketCategory>,
	now: Date = new Date(),
): boolean {
	if (categories.size === 0) {
		return false;
	}
	for (const category of categories) {
		if (isTrading(category, now)) {
			return true;
		}
	}
	return false;
}
