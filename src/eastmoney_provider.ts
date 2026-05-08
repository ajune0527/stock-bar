import axios, { AxiosError, AxiosInstance } from 'axios';
import Stock from './stock';

/**
 * 东方财富股票数据接口
 * 使用 push2.eastmoney.com 和 push2delay.eastmoney.com 接口
 */
class EastMoneyProvider {
	private ulistService: AxiosInstance;
	private stockService: AxiosInstance;
	private searchService: AxiosInstance;

	constructor() {
		const headers = {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
			'Referer': 'https://quote.eastmoney.com/',
			'Accept': 'application/json, text/plain, */*',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
		};

		// ulist 接口 - 批量获取股票行情
		this.ulistService = axios.create({
			timeout: 30000,
			baseURL: 'https://api.func.cool',
			headers,
		});

		// stock 接口 - 单只股票详情
		this.stockService = axios.create({
			timeout: 30000,
			baseURL: 'https://api.func.cool',
			headers,
		});

		// 搜索接口
		this.searchService = axios.create({
			timeout: 30000,
			baseURL: 'https://searchapi.eastmoney.com',
			headers,
		});

	}

	/**
	 * 批量获取股票实时数据
	 * 使用 ulist.np/get 接口
	 *
	 * @param secids secid 格式的字符串数组，如 ['1.000001', '0.399001']
	 */
	async fetch(secids: string[]): Promise<Partial<Stock>[]> {
		let lastError: Error | null = null;
		if (secids.length === 0) {
			return [];
		}

		try {
				const params = new URLSearchParams();
				params.set('fltt', '2');
				params.set('fields', 'f2,f3,f6,f12,f13,f14,f18');
				params.set('secids', secids.join(','));

				console.log(`[StockBar] Fetching:`, secids.join(','));

				const rep = await this.ulistService.get('/api/qt/ulist.np/get', {
					params,
					responseType: 'json',
				});

				if (!rep.data || !rep.data.data || !rep.data.data.diff) {
					return secids.map((secid) => {
						const code = secid.split('.')[1] || secid;
						return { code, name: '---' };
					});
				}

				const result: Partial<Stock>[] = [];

				for (const item of rep.data.data.diff) {
					const code = (item.f12 || '').toLowerCase();
					const mktNum = item.f13;
					const prefix = mktNum;

					const price = Number(item.f2) || 0;
					const yestclose = Number(item.f18) || 0;
					const percent = Number(item.f3) / 100;
					const updown = price - yestclose;

					result.push({
						code: code,
						name: item.f14 || '---',
						price,
						percent: Number(percent.toFixed(4)),
						updown: Number(updown.toFixed(3)),
						open: 0,
						high: 0,
						low: 0,
						yestclose,
					});
				}

				return result;
			} catch (err: unknown) {
				const error = err as AxiosError;
				lastError = error;
				if (error.code=='ECONNRESET') {
					return [];
				}
				console.error('[StockBar] Error code:', error.code);

				if (error.response) {
					console.error('[StockBar] Response status:', error.response.status);
					throw new Error(String(error.response.data));
				}
				if (error.request) {
					console.error('[StockBar] No response received');
					throw new Error('请求失败: ' + (error.message || '无响应'));
				}
				throw new Error(error.message);
			}
	}

	/**
	 * 搜索股票
	 * 使用 searchapi.eastmoney.com/api/suggest/get 接口
	 */
	async search(keyword: string, count: number = 10): Promise<StockSearchResult[]> {
		try {
			const params = new URLSearchParams();
			params.set('input', keyword);
			params.set('type', '14');
			params.set('count', count.toString());

			const rep = await this.searchService.get('/api/suggest/get', {
				params,
				responseType: 'json',
			});

			console.log('[StockBar] Search response for', keyword, ':', JSON.stringify(rep.data));

			// 解析返回数据结构
			// QuotationCodeTable.Data 数组
			if (!rep.data || !rep.data.QuotationCodeTable || !rep.data.QuotationCodeTable.Data) {
				return [];
			}

			const results: StockSearchResult[] = [];

			for (const item of rep.data.QuotationCodeTable.Data) {
				const code = item.Code || '';
				const name = item.Name || '';
				const market = item.MktNum;
				const securityTypeName = item.SecurityTypeName;
				results.push({
					code: code,
					name,
					market,
					securityTypeName
				});
			}

			return results.slice(0, count);
		} catch (err: unknown) {
			const error = err as AxiosError;
			if (error.response) {
				throw new Error(String(error.response.data));
			}
			if (error.request) {
				throw new Error('请求失败，请检查网络连接');
			}
			throw new Error(error.message);
		}
	}

	/**
	 * 获取股票分时数据
	 * 使用 trends2/get 接口
	 */
	async getTrends(secid: string): Promise<TrendData[]> {
		try {

			const params = new URLSearchParams();
			params.set('secid', secid);
			params.set('fields1', 'f1,f2,f8,f10');
			params.set('fields2', 'f51,f53,f56,f58');
			params.set('iscr', '0');
			params.set('iscca', '0');
			params.set('ndays', '1');

			const rep = await this.stockService.get('/api/qt/stock/trends2/get', {
				params,
				responseType: 'json',
			});

			console.log('[StockBar] Trends response for', secid, ':', rep.data?.data?.trends?.length || 0, 'points');

			if (!rep.data || !rep.data.data || !rep.data.data.trends) {
				return [];
			}

			const trends: TrendData[] = [];

			for (const item of rep.data.data.trends) {
				// 格式: 时间,价格,成交量,成交额
				const parts = item.split(',');
				if (parts.length >= 4) {
					trends.push({
						time: parts[0],
						price: Number(parts[1]) || 0,
						volume: Number(parts[2]) || 0,
						amount: Number(parts[3]) || 0,
					});
				}
			}

			return trends;
		} catch (err: unknown) {
			const error = err as AxiosError;
			console.error('[StockBar] Trends error:', error.message);
			throw new Error(error.message);
		}
	}
}

/**
 * 股票搜索结果
 */
export interface StockSearchResult {
	code: string;
	name: string;
	market: string;
	securityTypeName: string;
}

/**
 * 分时数据
 */
export interface TrendData {
	time: string;
	price: number;
	volume: number;
	amount: number;
}

// 导出单例
export const eastMoneyProvider = new EastMoneyProvider();