/* global suite, test */

'use strict';

const assert = require('assert');
const {
	fetchAxDataTrends,
	toAxDataInstrumentFromSecid,
} = require('../out/axdata_quote_provider');
const { parseTrendRecord } = require('../out/eastmoney_provider');
const Stock = require('../out/stock').default;
const {
	TrendSelectionModel,
	toTrendStockSnapshot,
} = require('../out/trend_selection_model');
const { getStockTrendHtml } = require('../out/view/stockTrendHtml');

function stock(code, market = '1', overrides = {}) {
	return {
		code,
		market,
		name: code,
		price: 10,
		updown: 0.1,
		percent: 0.01,
		yestclose: 9.9,
		category: 'A',
		...overrides,
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function flushPromises() {
	return new Promise((resolve) => setImmediate(resolve));
}

suite('Sidebar trend selection model', function () {
	test('refetches the latest trend data on every selection', async function () {
		const request = deferred();
		const states = [];
		let fetchCount = 0;
		const model = new TrendSelectionModel(
			(secid) => {
				fetchCount += 1;
				assert.equal(secid, '1.600000');
				return request.promise;
			},
			(state) => states.push(state),
		);

		model.select(stock('600000'));
		assert.equal(states.at(-1).status, 'loading');
		request.resolve([{ time: '09:30', price: 8.69, volume: 100, amount: 869 }]);
		await flushPromises();

		assert.equal(states.at(-1).status, 'ready');
		assert.equal(states.at(-1).trends[0].volume, 100);
		model.select(stock('600000', '1', { price: 8.7 }));
		assert.equal(states.at(-1).status, 'loading');
		assert.equal(fetchCount, 2);
	});

	test('ignores a stale response after selecting another stock', async function () {
		const requests = new Map();
		const states = [];
		const model = new TrendSelectionModel(
			(secid) => {
				const request = deferred();
				requests.set(secid, request);
				return request.promise;
			},
			(state) => states.push(state),
		);

		model.select(stock('600000'));
		model.select(stock('000001', '0'));
		requests
			.get('0.000001')
			.resolve([{ time: '09:30', price: 10, volume: 20, amount: 200 }]);
		await flushPromises();
		requests
			.get('1.600000')
			.resolve([{ time: '09:30', price: 8, volume: 30, amount: 240 }]);
		await flushPromises();

		assert.equal(states.at(-1).stock.code, '000001');
		assert.equal(states.at(-1).trends[0].price, 10);
	});

	test('syncs live quotes without refetching and clears a removed stock', async function () {
		let fetchCount = 0;
		const states = [];
		const model = new TrendSelectionModel(
			async () => {
				fetchCount += 1;
				return [{ time: '09:30', price: 8.6, volume: 10, amount: 86 }];
			},
			(state) => states.push(state),
		);

		model.select(stock('600000'));
		await flushPromises();
		model.syncStocks([stock('600000', '1', { price: 8.88 })]);

		assert.equal(states.at(-1).status, 'ready');
		assert.equal(states.at(-1).stock.price, 8.88);
		assert.equal(fetchCount, 1);

		model.syncStocks([stock('000001', '0')]);
		assert.equal(states.at(-1).status, 'empty');
		assert.equal(model.currentState().status, 'empty');
	});

	test('refresh bypasses the cache', async function () {
		let fetchCount = 0;
		const model = new TrendSelectionModel(
			async () => {
				fetchCount += 1;
				return [
					{
						time: '09:30',
						price: fetchCount,
						volume: fetchCount * 10,
						amount: fetchCount * 10,
					},
				];
			},
			() => {},
		);

		model.select(stock('600000'));
		await flushPromises();
		model.refresh();
		await flushPromises();

		assert.equal(fetchCount, 2);
		assert.equal(model.currentState().trends[0].price, 2);
	});

	test('autoRefresh silently replaces trends without a loading state', async function () {
		const requests = [];
		const states = [];
		const model = new TrendSelectionModel(
			() => {
				const request = deferred();
				requests.push(request);
				return request.promise;
			},
			(state) => states.push(state),
		);

		model.select(stock('600000'));
		requests[0].resolve([{ time: '09:30', price: 8.6, volume: 10, amount: 86 }]);
		await flushPromises();
		assert.equal(states.at(-1).status, 'ready');

		model.autoRefresh();
		assert.equal(states.at(-1).status, 'ready');
		requests[1].resolve([{ time: '09:30', price: 8.7, volume: 20, amount: 174 }]);
		await flushPromises();

		assert.equal(states.at(-1).status, 'ready');
		assert.equal(states.at(-1).trends[0].price, 8.7);
		assert.equal(requests.length, 2);
	});

	test('autoRefresh keeps the old chart when the fetch fails', async function () {
		const requests = [];
		const states = [];
		const model = new TrendSelectionModel(
			() => {
				const request = deferred();
				requests.push(request);
				return request.promise;
			},
			(state) => states.push(state),
		);

		model.select({ ...stock('600000'), price: 8.6 });
		requests[0].resolve([{ time: '09:30', price: 8.6, volume: 100, amount: 86 }]);
		await flushPromises();

		model.autoRefresh();
		requests[1].reject(new Error('network down'));
		await flushPromises();

		assert.equal(states.at(-1).status, 'ready');
		assert.equal(states.at(-1).trends[0].price, 8.6);
	});

	test('a stale response cannot overwrite a newer selection', async function () {
		const requests = [];
		const model = new TrendSelectionModel(
			() => {
				const request = deferred();
				requests.push(request);
				return request.promise;
			},
			() => {},
		);
		const selected = stock('600000');

		model.select(selected);
		model.refresh();
		requests[1].resolve([{ time: '09:30', price: 2, volume: 20, amount: 40 }]);
		await flushPromises();
		requests[0].resolve([{ time: '09:30', price: 1, volume: 10, amount: 10 }]);
		await flushPromises();

		assert.equal(model.currentState().trends[0].price, 2);
		assert.equal(requests.length, 2);
	});
});

suite('Sidebar trend HTML', function () {
	test('contains a CSP-protected price and volume chart contract', function () {
		const html = getStockTrendHtml('vscode-webview://stock-bar', 'nonce-value');

		assert.match(html, /Content-Security-Policy/);
		assert.match(html, /<canvas id="trend-chart"/);
		assert.match(html, /point\.volume/);
		assert.match(html, /volumeHeight/);
		assert.match(html, /point\.averagePrice/);
		assert.match(html, /averagePrices/);
		assert.match(html, /averageLineColor/);
		assert.match(html, />均价</);
		assert.match(html, /command:\s*'refresh'/);
		assert.match(html, /command:\s*'ready'/);
		assert.match(html, /<script nonce="nonce-value">/);
		assert.doesNotMatch(html, /600000|浦发银行/);
	});
});

suite('Sidebar trend stock snapshot', function () {
	test('converts a live Stock without losing its secid or quote fields', function () {
		const liveStock = new Stock('600000', '1');
		liveStock.update({
			name: '浦发银行',
			price: 8.69,
			updown: -0.01,
			percent: -0.00114943,
			yestclose: 8.7,
		});

		assert.deepEqual(toTrendStockSnapshot(liveStock), {
			code: '600000',
			market: '1',
			name: '浦发银行',
			price: 8.69,
			updown: -0.01,
			percent: -0.00114943,
			yestclose: 8.7,
			category: 'A',
		});
	});
});

suite('EastMoney trend parsing', function () {
	test('maps the fourth field to the cumulative average price', function () {
		assert.deepEqual(parseTrendRecord('2026-07-29 09:31,9.24,15709,9.219'), {
			time: '2026-07-29 09:31',
			price: 9.24,
			volume: 15709,
			amount: 9.219,
			averagePrice: 9.219,
		});
	});

	test('rejects incomplete trend records', function () {
		assert.equal(parseTrendRecord('incomplete,9.24,1'), null);
	});
});

suite('AxData intraday trends', function () {
	test('maps AxData price, average price, and volume into chart data', async function () {
		const requests = [];
		const trends = await fetchAxDataTrends(
			'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx',
			'secret',
			'600000.SH',
			async (url, body, config) => {
				requests.push({ url, body, config });
				return {
					data: {
						data: [
							{
								instrument_id: '600000.SH',
								time_label: '09:31',
								price: 9.3,
								avg_price: 9.2736,
								volume: 12403,
							},
						],
					},
				};
			},
		);

		assert.deepEqual(trends, [
			{
				time: '09:31',
				price: 9.3,
				volume: 12403,
				amount: 9.2736,
				averagePrice: 9.2736,
			},
		]);
		assert.deepEqual(requests, [
			{
				url: 'http://127.0.0.1:8666/v1/request/stock_intraday_today_tdx',
				body: {
					params: { code: '600000.SH' },
					fields: [
						'instrument_id',
						'time_label',
						'price',
						'avg_price',
						'volume',
					],
					persist: false,
				},
				config: {
					headers: { Authorization: 'Bearer secret' },
					timeout: 30000,
				},
			},
		]);
	});

	test('converts sidebar secids to AxData instruments', function () {
		assert.equal(toAxDataInstrumentFromSecid('1.600000'), '600000.SH');
		assert.equal(toAxDataInstrumentFromSecid('0.399006'), '399006.SZ');
		assert.equal(toAxDataInstrumentFromSecid('116.00700'), null);
	});
});
