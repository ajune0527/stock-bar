import axios from 'axios';
import Stock from './stock';
import WebSocket = require('ws');

const QUOTE_FIELDS = [
	'instrument_id',
	'symbol',
	'last_price',
	'pre_close',
	'change',
	'change_pct',
	'open',
	'high',
	'low',
];
const MIN_INTERVAL_MS = 500;
const MAX_INSTRUMENTS_PER_SUBSCRIPTION = 100;
const MAX_RECONNECT_DELAY_MS = 30000;

interface WebSocketLike {
	on(event: string, listener: (...args: any[]) => void): this;
	send(data: string): void;
	close(): void;
}

type ReconnectTimer = ReturnType<typeof setTimeout> | number;

export interface AxDataQuoteProviderDependencies {
	createSocket?: (url: string) => WebSocketLike;
	setReconnectTimer?: (callback: () => void, delay: number) => ReconnectTimer;
	clearReconnectTimer?: (timer: ReconnectTimer) => void;
}

export interface AxDataQuoteSubscription {
	url: string;
	token: string;
	instruments: string[];
	intervalMs: number;
	onQuotes: (updates: Partial<Stock>[]) => void;
	onStateChange: (connected: boolean) => void;
	onError: (error: Error) => void;
}

export interface AxDataQuoteRow {
	instrument_id?: unknown;
	symbol?: unknown;
	last_price?: unknown;
	pre_close?: unknown;
	change?: unknown;
	change_pct?: unknown;
	open?: unknown;
	high?: unknown;
	low?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
	if (value === null || value === undefined || value === '') {
		return undefined;
	}
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) ? number : undefined;
}

export function toAxDataInstrument(
	stock: Pick<Stock, 'code' | 'market'>,
): string | null {
	if (stock.market === '1') {
		return `${stock.code}.SH`;
	}
	if (stock.market === '0') {
		return `${stock.code}.SZ`;
	}
	return null;
}

export function buildAxDataWebSocketUrl(
	baseUrl: string,
	token: string,
): string {
	const url = new URL(baseUrl);
	if (token.trim()) {
		url.searchParams.set('token', token.trim());
	}
	return url.toString();
}

export function buildAxDataStockNamesUrl(webSocketUrl: string): string {
	return buildAxDataRequestUrl(webSocketUrl, 'stock_codes_tdx');
}

function buildAxDataRequestUrl(
	webSocketUrl: string,
	interfaceName: string,
): string {
	const url = new URL(webSocketUrl);
	url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
	url.pathname = `/v1/request/${interfaceName}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

type AxDataPost = (
	url: string,
	body: {
		params: { code: string | string[] };
		fields: string[];
		persist: boolean;
	},
	config: {
		headers?: Record<string, string>;
		timeout: number;
	},
) => Promise<{ data?: { data?: unknown } }>;

export async function fetchAxDataStockNames(
	webSocketUrl: string,
	token: string,
	instruments: string[],
	post: AxDataPost = axios.post,
): Promise<Array<{ instrumentId: string; code: string; name: string }>> {
	if (instruments.length === 0) {
		return [];
	}
	const headers = token.trim()
		? { Authorization: `Bearer ${token.trim()}` }
		: undefined;
	const body = {
		params: { code: instruments },
		fields: ['instrument_id', 'symbol', 'name'],
		persist: false,
	};
	const responses = await Promise.all(
		['stock_codes_tdx', 'index_codes_tdx'].map((interfaceName) =>
			post(buildAxDataRequestUrl(webSocketUrl, interfaceName), body, {
				headers,
				timeout: 30000,
			}),
		),
	);
	const rows = responses.flatMap((response) =>
		Array.isArray(response.data?.data) ? response.data.data : [],
	);
	return rows
		.map((row: any) => ({
			instrumentId:
				typeof row?.instrument_id === 'string'
					? row.instrument_id.trim().toUpperCase()
					: '',
			code: typeof row?.symbol === 'string' ? row.symbol.trim() : '',
			name: typeof row?.name === 'string' ? row.name.trim() : '',
		}))
		.filter((row) => row.instrumentId && row.code && row.name);
}

export function toAxDataInstrumentFromSecid(secid: string): string | null {
	const separator = secid.indexOf('.');
	if (separator < 1) {
		return null;
	}
	return toAxDataInstrument({
		market: secid.slice(0, separator),
		code: secid.slice(separator + 1),
	});
}

export async function fetchAxDataTrends(
	webSocketUrl: string,
	token: string,
	instrument: string,
	post: AxDataPost = axios.post,
): Promise<
	Array<{
		time: string;
		price: number;
		volume: number;
		amount: number;
		averagePrice: number;
	}>
> {
	const headers = token.trim()
		? { Authorization: `Bearer ${token.trim()}` }
		: undefined;
	const response = await post(
		buildAxDataRequestUrl(webSocketUrl, 'stock_intraday_today_tdx'),
		{
			params: { code: instrument },
			fields: ['instrument_id', 'time_label', 'price', 'avg_price', 'volume'],
			persist: false,
		},
		{ headers, timeout: 30000 },
	);
	const rows = Array.isArray(response.data?.data) ? response.data.data : [];
	return rows
		.map((row: any) => {
			const time =
				typeof row?.time_label === 'string' ? row.time_label.trim() : '';
			const price = finiteNumber(row?.price);
			if (!time || price === undefined) {
				return null;
			}
			const averagePrice = finiteNumber(row?.avg_price) ?? 0;
			return {
				time,
				price,
				volume: finiteNumber(row?.volume) ?? 0,
				amount: averagePrice,
				averagePrice,
			};
		})
		.filter(
			(
				row,
			): row is {
				time: string;
				price: number;
				volume: number;
				amount: number;
				averagePrice: number;
			} => row !== null,
		);
}

export function toStockUpdate(row: AxDataQuoteRow): Partial<Stock> | null {
	const price = finiteNumber(row.last_price);
	const instrumentId =
		typeof row.instrument_id === 'string' ? row.instrument_id : '';
	const symbol =
		typeof row.symbol === 'string'
			? row.symbol
			: instrumentId.split('.')[0] || '';

	if (!symbol || price === undefined) {
		return null;
	}

	const update: Partial<Stock> = {
		code: symbol,
		price,
	};
	const mappings: Array<
		[
			keyof AxDataQuoteRow,
			keyof Pick<Stock, 'yestclose' | 'updown' | 'open' | 'high' | 'low'>,
		]
	> = [
		['pre_close', 'yestclose'],
		['change', 'updown'],
		['open', 'open'],
		['high', 'high'],
		['low', 'low'],
	];

	for (const [source, target] of mappings) {
		const value = finiteNumber(row[source]);
		if (value !== undefined) {
			update[target] = value;
		}
	}

	const changePct = finiteNumber(row.change_pct);
	if (changePct !== undefined) {
		update.percent = Number((changePct / 100).toFixed(8));
	}
	return update;
}

export function selectEastMoneyFallbackStocks<
	T extends Pick<Stock, 'code' | 'market'>,
>(
	stocks: readonly T[],
	axDataConnected: boolean,
	coveredCodes: ReadonlySet<string>,
): T[] {
	if (!axDataConnected) {
		return [...stocks];
	}
	return stocks.filter((stock) => {
		const instrument = toAxDataInstrument(stock);
		return instrument === null || !coveredCodes.has(stock.code.toLowerCase());
	});
}

export class AxDataQuoteProvider {
	private readonly createSocket: (url: string) => WebSocketLike;
	private readonly setReconnectTimer: (
		callback: () => void,
		delay: number,
	) => ReconnectTimer;
	private readonly clearReconnectTimer: (timer: ReconnectTimer) => void;
	private socket: WebSocketLike | null = null;
	private reconnectTimer: ReconnectTimer | null = null;
	private subscription: AxDataQuoteSubscription | null = null;
	private connected = false;
	private reconnectAttempt = 0;
	private shouldReconnect = false;
	private readonly covered = new Set<string>();

	constructor(dependencies: AxDataQuoteProviderDependencies = {}) {
		this.createSocket =
			dependencies.createSocket ?? ((url) => new WebSocket(url));
		this.setReconnectTimer =
			dependencies.setReconnectTimer ??
			((callback, delay) => setTimeout(callback, delay));
		this.clearReconnectTimer =
			dependencies.clearReconnectTimer ??
			((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	}

	start(subscription: AxDataQuoteSubscription): void {
		this.stop();
		const instruments = [...new Set(subscription.instruments)]
			.map((instrument) => instrument.trim().toUpperCase())
			.filter(Boolean)
			.sort()
			.slice(0, MAX_INSTRUMENTS_PER_SUBSCRIPTION);
		if (instruments.length === 0) {
			return;
		}
		this.subscription = {
			...subscription,
			instruments,
			intervalMs: Math.max(MIN_INTERVAL_MS, subscription.intervalMs),
		};
		this.shouldReconnect = true;
		this.connect();
	}

	stop(): void {
		this.shouldReconnect = false;
		this.reconnectAttempt = 0;
		this.covered.clear();
		if (this.reconnectTimer !== null) {
			this.clearReconnectTimer(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const socket = this.socket;
		this.socket = null;
		if (socket) {
			socket.close();
		}
		this.setConnected(false);
		this.subscription = null;
	}

	isConnected(): boolean {
		return this.connected;
	}

	coveredCodes(): ReadonlySet<string> {
		return this.covered;
	}

	private connect(): void {
		if (!this.shouldReconnect || !this.subscription) {
			return;
		}

		let socket: WebSocketLike;
		try {
			socket = this.createSocket(
				buildAxDataWebSocketUrl(this.subscription.url, this.subscription.token),
			);
		} catch (error) {
			this.reportError(error);
			this.scheduleReconnect();
			return;
		}
		this.socket = socket;

		socket.on('open', () => {
			if (this.socket !== socket || !this.subscription) {
				return;
			}
			this.reconnectAttempt = 0;
			this.setConnected(true);
			socket.send(
				JSON.stringify({
					op: 'subscribe',
					id: 'stock-bar',
					params: {
						code: this.subscription.instruments,
						fields: QUOTE_FIELDS,
						interval_ms: this.subscription.intervalMs,
						initial_snapshot: true,
					},
				}),
			);
		});
		socket.on('message', (data: unknown) => {
			if (this.socket === socket) {
				this.handleMessage(data);
			}
		});
		socket.on('error', (error: unknown) => {
			if (this.socket !== socket) {
				return;
			}
			this.reportError(error);
			this.disconnect(socket, true);
		});
		socket.on('close', () => {
			if (this.socket !== socket) {
				return;
			}
			this.socket = null;
			this.covered.clear();
			this.setConnected(false);
			this.scheduleReconnect();
		});
	}

	private handleMessage(data: unknown): void {
		let message: any;
		try {
			message = JSON.parse(String(data));
		} catch {
			this.reportError(new Error('AxData 返回了无效的 WebSocket 消息'));
			return;
		}

		if (message?.type === 'error') {
			const detail = message.error?.message || 'AxData 行情订阅失败';
			this.reportError(new Error(String(detail)));
			if (this.socket) {
				this.disconnect(this.socket, true);
			}
			return;
		}
		if (message?.type !== 'snapshot' && message?.type !== 'update') {
			return;
		}

		const rows = Array.isArray(message.data) ? message.data : [];
		const updates = rows
			.map((row: AxDataQuoteRow) => toStockUpdate(row))
			.filter((row: Partial<Stock> | null): row is Partial<Stock> => !!row);
		if (message.type === 'snapshot') {
			this.covered.clear();
		}
		for (const update of updates) {
			if (update.code) {
				this.covered.add(update.code.toLowerCase());
			}
		}
		if (updates.length > 0) {
			this.subscription?.onQuotes(updates);
		}
	}

	private scheduleReconnect(): void {
		if (
			!this.shouldReconnect ||
			!this.subscription ||
			this.reconnectTimer !== null
		) {
			return;
		}
		const delay = Math.min(
			1000 * 2 ** this.reconnectAttempt,
			MAX_RECONNECT_DELAY_MS,
		);
		this.reconnectAttempt += 1;
		this.reconnectTimer = this.setReconnectTimer(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	private disconnect(socket: WebSocketLike, closeSocket: boolean): void {
		if (this.socket !== socket) {
			return;
		}
		this.socket = null;
		this.covered.clear();
		if (closeSocket) {
			socket.close();
		}
		this.setConnected(false);
		this.scheduleReconnect();
	}

	private setConnected(connected: boolean): void {
		if (this.connected === connected) {
			return;
		}
		this.connected = connected;
		this.subscription?.onStateChange(connected);
	}

	private reportError(error: unknown): void {
		const normalized =
			error instanceof Error ? error : new Error(String(error));
		this.subscription?.onError(normalized);
	}
}
