/* global suite, test */

'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const Stock = require('../out/stock').default;
const {
	AxDataQuoteProvider,
	buildAxDataStockNamesUrl,
	buildAxDataWebSocketUrl,
	fetchAxDataStockNames,
	selectEastMoneyFallbackStocks,
	toAxDataInstrument,
	toStockUpdate,
} = require('../out/axdata_quote_provider');

class FakeWebSocket extends EventEmitter {
	constructor(url) {
		super();
		this.url = url;
		this.sent = [];
		this.closed = false;
	}

	send(data) {
		this.sent.push(String(data));
	}

	close() {
		this.closed = true;
		this.emit('close');
	}
}

suite('AxData quote protocol', function () {
	test('maps EastMoney A-share markets to AxData instruments', function () {
		assert.equal(
			toAxDataInstrument({ code: '600000', market: '1' }),
			'600000.SH',
		);
		assert.equal(
			toAxDataInstrument({ code: '000001', market: '0' }),
			'000001.SZ',
		);
		assert.equal(toAxDataInstrument({ code: '00700', market: '116' }), null);
	});

	test('adds an encoded token without losing existing query parameters', function () {
		assert.equal(
			buildAxDataWebSocketUrl(
				'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx?client=stock-bar',
				'a b',
			),
			'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx?client=stock-bar&token=a+b',
		);
	});

	test('builds the stock names endpoint from the configured WebSocket URL', function () {
		assert.equal(
			buildAxDataStockNamesUrl(
				'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx?client=stock-bar',
			),
			'http://127.0.0.1:8666/v1/request/stock_codes_tdx',
		);
		assert.equal(
			buildAxDataStockNamesUrl(
				'wss://axdata.example.com/v1/stream/stock_quote_refresh_tdx',
			),
			'https://axdata.example.com/v1/request/stock_codes_tdx',
		);
	});

	test('loads A-share names from the AxData stock code endpoint', async function () {
		const requests = [];
		const names = await fetchAxDataStockNames(
			'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx',
			'secret',
			['600000.SH', '000001.SZ'],
			async (url, body, config) => {
				requests.push({ url, body, config });
				return {
					data: {
						data: url.includes('index_codes_tdx')
							? [
									{
										instrument_id: '000001.SH',
										symbol: '000001',
										name: '上证指数',
									},
							  ]
							: [
									{
										instrument_id: '600000.SH',
										symbol: '600000',
										name: '浦发银行',
									},
									{
										instrument_id: '000001.SZ',
										symbol: '000001',
										name: '平安银行',
									},
							  ],
					},
				};
			},
		);

		assert.deepEqual(names, [
			{
				instrumentId: '600000.SH',
				code: '600000',
				name: '浦发银行',
			},
			{
				instrumentId: '000001.SZ',
				code: '000001',
				name: '平安银行',
			},
			{
				instrumentId: '000001.SH',
				code: '000001',
				name: '上证指数',
			},
		]);
		assert.deepEqual(
			requests.map(({ url, body }) => ({ url, body })),
			[
				{
					url: 'http://127.0.0.1:8666/v1/request/stock_codes_tdx',
					body: {
						params: { code: ['600000.SH', '000001.SZ'] },
						fields: ['instrument_id', 'symbol', 'name'],
						persist: false,
					},
				},
				{
					url: 'http://127.0.0.1:8666/v1/request/index_codes_tdx',
					body: {
						params: { code: ['600000.SH', '000001.SZ'] },
						fields: ['instrument_id', 'symbol', 'name'],
						persist: false,
					},
				},
			],
		);
		assert.deepEqual(requests[0].config, {
			headers: { Authorization: 'Bearer secret' },
			timeout: 30000,
		});
	});

	test('maps AxData percentages and quote fields to Stock units', function () {
		assert.deepEqual(
			toStockUpdate({
				instrument_id: '600000.SH',
				symbol: '600000',
				last_price: 8.69,
				pre_close: 8.7,
				change: -0.01,
				change_pct: -0.114943,
				open: 8.69,
				high: 8.82,
				low: 8.59,
			}),
			{
				code: '600000',
				price: 8.69,
				yestclose: 8.7,
				updown: -0.01,
				percent: -0.00114943,
				open: 8.69,
				high: 8.82,
				low: 8.59,
			},
		);
	});

	test('preserves zero values and rejects rows without a price', function () {
		assert.deepEqual(
			toStockUpdate({
				instrument_id: '000001.SZ',
				last_price: 0,
				pre_close: 0,
				change: 0,
				change_pct: 0,
				open: 0,
				high: 0,
				low: 0,
			}),
			{
				code: '000001',
				price: 0,
				yestclose: 0,
				updown: 0,
				percent: 0,
				open: 0,
				high: 0,
				low: 0,
			},
		);
		assert.equal(
			toStockUpdate({ instrument_id: '000001.SZ', last_price: null }),
			null,
		);
	});
});

suite('AxData quote connection', function () {
	test('subscribes on open, publishes snapshots, and stops without reconnecting', function () {
		const sockets = [];
		const timers = [];
		const quotes = [];
		const states = [];
		const provider = new AxDataQuoteProvider({
			createSocket(url) {
				const socket = new FakeWebSocket(url);
				sockets.push(socket);
				return socket;
			},
			setReconnectTimer(callback, delay) {
				timers.push({ callback, delay });
				return timers.length;
			},
			clearReconnectTimer() {},
		});

		provider.start({
			url: 'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx',
			token: 'secret',
			instruments: ['600000.SH', '000001.SZ', '600000.SH'],
			intervalMs: 250,
			onQuotes(updates) {
				quotes.push(updates);
			},
			onStateChange(connected) {
				states.push(connected);
			},
			onError(error) {
				assert.fail(error.message);
			},
		});

		assert.equal(
			sockets[0].url,
			'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx?token=secret',
		);
		sockets[0].emit('open');
		assert.deepEqual(JSON.parse(sockets[0].sent[0]), {
			op: 'subscribe',
			id: 'stock-bar',
			params: {
				code: ['000001.SZ', '600000.SH'],
				fields: [
					'instrument_id',
					'symbol',
					'last_price',
					'pre_close',
					'change',
					'change_pct',
					'open',
					'high',
					'low',
				],
				interval_ms: 500,
				initial_snapshot: true,
			},
		});

		sockets[0].emit(
			'message',
			JSON.stringify({
				type: 'snapshot',
				data: [
					{
						instrument_id: '600000.SH',
						last_price: 8.69,
						pre_close: 8.7,
						change_pct: -0.114943,
					},
				],
			}),
		);
		assert.equal(quotes.length, 1);
		assert.equal(quotes[0][0].code, '600000');
		assert.deepEqual([...provider.coveredCodes()], ['600000']);
		assert.equal(provider.isConnected(), true);
		assert.deepEqual(states, [true]);

		provider.stop();
		assert.equal(sockets[0].closed, true);
		assert.equal(provider.isConnected(), false);
		assert.deepEqual(states, [true, false]);
		assert.equal(timers.length, 0);
	});

	test('reconnects after an unexpected close', function () {
		const sockets = [];
		const timers = [];
		const provider = new AxDataQuoteProvider({
			createSocket(url) {
				const socket = new FakeWebSocket(url);
				sockets.push(socket);
				return socket;
			},
			setReconnectTimer(callback, delay) {
				timers.push({ callback, delay });
				return timers.length;
			},
			clearReconnectTimer() {},
		});

		provider.start({
			url: 'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx',
			token: '',
			instruments: ['000001.SZ'],
			intervalMs: 3000,
			onQuotes() {},
			onStateChange() {},
			onError() {},
		});
		sockets[0].emit('open');
		sockets[0].emit(
			'message',
			JSON.stringify({
				type: 'snapshot',
				data: [{ instrument_id: '000001.SZ', last_price: 10 }],
			}),
		);
		assert.deepEqual([...provider.coveredCodes()], ['000001']);
		sockets[0].emit('close');

		assert.deepEqual([...provider.coveredCodes()], []);
		assert.equal(timers.length, 1);
		assert.equal(timers[0].delay, 1000);
		timers[0].callback();
		assert.equal(sockets.length, 2);
	});

	test('closes a failed socket before scheduling reconnect', function () {
		const sockets = [];
		const timers = [];
		const provider = new AxDataQuoteProvider({
			createSocket(url) {
				const socket = new FakeWebSocket(url);
				sockets.push(socket);
				return socket;
			},
			setReconnectTimer(callback, delay) {
				timers.push({ callback, delay });
				return timers.length;
			},
			clearReconnectTimer() {},
		});
		provider.start({
			url: 'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx',
			token: '',
			instruments: ['000001.SZ'],
			intervalMs: 3000,
			onQuotes() {},
			onStateChange() {},
			onError() {},
		});

		sockets[0].emit('error', new Error('connection failed'));

		assert.equal(sockets[0].closed, true);
		assert.equal(timers.length, 1);
	});

	test('limits one AxData subscription to 100 instruments', function () {
		const sockets = [];
		const provider = new AxDataQuoteProvider({
			createSocket(url) {
				const socket = new FakeWebSocket(url);
				sockets.push(socket);
				return socket;
			},
		});
		const instruments = Array.from(
			{ length: 101 },
			(_, index) => `${String(index).padStart(6, '0')}.SZ`,
		);
		provider.start({
			url: 'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx',
			token: '',
			instruments,
			intervalMs: 3000,
			onQuotes() {},
			onStateChange() {},
			onError() {},
		});

		sockets[0].emit('open');

		const subscription = JSON.parse(sockets[0].sent[0]);
		assert.equal(subscription.params.code.length, 100);
		provider.stop();
	});
});

suite('AxData fallback selection', function () {
	test('uses EastMoney for every stock while AxData is disconnected', function () {
		const stocks = [
			{ code: '600000', market: '1' },
			{ code: '000001', market: '0' },
			{ code: '00700', market: '116' },
		];
		assert.deepEqual(
			selectEastMoneyFallbackStocks(
				stocks,
				false,
				new Set(['600000', '000001']),
			),
			stocks,
		);
	});

	test('uses EastMoney only for non-A shares and uncovered A shares', function () {
		const covered = { code: '600000', market: '1' };
		const uncovered = { code: '000001', market: '0' };
		const hk = { code: '00700', market: '116' };
		assert.deepEqual(
			selectEastMoneyFallbackStocks(
				[covered, uncovered, hk],
				true,
				new Set(['600000']),
			),
			[uncovered, hk],
		);
	});
});

suite('Stock partial updates', function () {
	test('keeps metadata and untouched quote fields on a realtime partial update', function () {
		const stock = new Stock('600000', '1');
		stock.update({
			name: '浦发银行',
			price: 8.7,
			yestclose: 8.6,
			high: 8.8,
		});

		stock.update({ code: '600000', price: 8.69, percent: -0.001 });

		assert.equal(stock.name, '浦发银行');
		assert.equal(stock.price, 8.69);
		assert.equal(stock.percent, -0.001);
		assert.equal(stock.yestclose, 8.6);
		assert.equal(stock.high, 8.8);
	});
});
