# AxData Realtime Quote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive A-share realtime prices from AxData's `stock_quote_refresh_tdx` WebSocket while retaining EastMoney for other markets and automatic fallback.

**Architecture:** A focused `AxDataQuoteProvider` owns the WebSocket protocol and reconnect lifecycle, while `StockBarController` coordinates provider state, EastMoney fallback, and rendering. Pure exported mapping helpers keep protocol conversion independently testable.

**Tech Stack:** TypeScript 4.7, VS Code Extension API, `ws`, Mocha, Webpack.

## Global Constraints

- Preserve the user's existing uncommitted market tabs, drag-and-drop ordering, and multi-market chart changes.
- Default endpoint is `ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx`.
- A non-empty token is sent as the WebSocket URL `token` query parameter and is never logged.
- AxData subscription intervals are at least 500 milliseconds.
- EastMoney remains the source for HK/US quotes, search, charts, A-share names, and A-share fallback.
- Do not modify the AxData server or add a generic provider framework.

---

### Task 1: Protocol mapping and configuration

**Files:**
- Create: `src/axdata_quote_provider.ts`
- Modify: `src/configuration.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/axdata_quote_provider.test.js`

**Interfaces:**
- Produces: `toAxDataInstrument(stock: Pick<Stock, "code" | "market">): string | null`
- Produces: `buildAxDataWebSocketUrl(baseUrl: string, token: string): string`
- Produces: `toStockUpdate(row: AxDataQuoteRow): Partial<Stock> | null`
- Produces: `Configuration.getAxDataWebSocketUrl(): string`
- Produces: `Configuration.getAxDataToken(): string`

- [ ] **Step 1: Add failing mapping and configuration tests**

Add tests that assert:

```js
assert.equal(toAxDataInstrument({ code: '600000', market: '1' }), '600000.SH');
assert.equal(toAxDataInstrument({ code: '000001', market: '0' }), '000001.SZ');
assert.equal(toAxDataInstrument({ code: '00700', market: '116' }), null);
assert.equal(
  buildAxDataWebSocketUrl('ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx', 'a b'),
  'ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx?token=a+b',
);
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
```

- [ ] **Step 2: Compile and run the test to verify failure**

Run: `npm run compile-tests && npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: FAIL because `out/axdata_quote_provider` does not exist.

- [ ] **Step 3: Add the dependency and minimal pure helpers**

Run: `npm install ws@^8.18.0 && npm install --save-dev @types/ws@^8.5.13`

Implement strict finite-number conversion in `toStockUpdate`; return `null`
when the row has no symbol/code or no finite `last_price`. Preserve numeric zero
instead of treating it as absent.

- [ ] **Step 4: Add configuration properties and getters**

Add package contributions:

```json
"stock-bar.axDataWebSocketUrl": {
  "type": "string",
  "default": "ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx",
  "description": "AxData A股实时行情 WebSocket 地址"
},
"stock-bar.axDataToken": {
  "type": "string",
  "default": "",
  "description": "AxData API Token（未启用鉴权时留空）"
}
```

Add getters returning those exact defaults when values are absent or blank.

- [ ] **Step 5: Compile and run the focused test**

Run: `npm run compile-tests && npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: all mapping tests PASS.

### Task 2: WebSocket lifecycle and subscription

**Files:**
- Modify: `src/axdata_quote_provider.ts`
- Modify: `test/axdata_quote_provider.test.js`

**Interfaces:**
- Consumes: the pure helpers from Task 1.
- Produces: `AxDataQuoteProvider.start(options: AxDataQuoteSubscription): void`
- Produces: `AxDataQuoteProvider.stop(): void`
- Produces: `AxDataQuoteProvider.isConnected(): boolean`
- Produces: `AxDataQuoteProvider.coveredCodes(): ReadonlySet<string>`
- Produces callbacks `onQuotes`, `onStateChange`, and `onError`.

- [ ] **Step 1: Add a failing fake-socket lifecycle test**

Create a fake WebSocket with `on`, `send`, `close`, and event emit support.
Assert that `open` sends:

```json
{
  "op": "subscribe",
  "id": "stock-bar",
  "params": {
    "code": ["000001.SZ", "600000.SH"],
    "fields": ["instrument_id", "symbol", "last_price", "pre_close", "change", "change_pct", "open", "high", "low"],
    "interval_ms": 500,
    "initial_snapshot": true
  }
}
```

Assert that snapshot rows call `onQuotes`, update the covered-code set, and that
`stop()` closes the socket without scheduling reconnect.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npm run compile-tests && npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: FAIL because the provider lifecycle is not implemented.

- [ ] **Step 3: Implement the lifecycle**

Inject a `WebSocketFactory` and timer functions through optional constructor
dependencies. Use production defaults based on `ws`, `setTimeout`, and
`clearTimeout`. Normalize and sort/deduplicate instrument IDs before subscribing.
Use reconnect delays of 1, 2, 4, 8, 16, and at most 30 seconds.

On `snapshot` clear coverage before adding valid rows. On `update` retain
coverage and add every valid returned code. Ignore empty updates. On protocol
`error`, socket `error`, or unexpected `close`, report the failure, mark
disconnected, and schedule one reconnect. Reset the retry counter after `open`.

- [ ] **Step 4: Run focused tests**

Run: `npm run compile-tests && npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: mapping and lifecycle tests PASS.

### Task 3: Controller coordination and fallback

**Files:**
- Modify: `src/StockBarController.ts`
- Modify: `src/axdata_quote_provider.ts`
- Modify: `test/axdata_quote_provider.test.js`

**Interfaces:**
- Consumes: `AxDataQuoteProvider` from Task 2.
- Produces: controller behavior where AxData owns covered A-share quotes and EastMoney updates every other configured stock.

- [ ] **Step 1: Add a failing fallback-selection test**

Export and test a pure helper:

```ts
selectEastMoneyFallbackStocks(
  stocks: readonly Stock[],
  axDataConnected: boolean,
  coveredCodes: ReadonlySet<string>,
): Stock[]
```

Assert disconnected returns every stock. Assert connected returns HK/US plus
uncovered A-share codes, but excludes covered A-share codes.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npm run compile-tests && npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: FAIL because `selectEastMoneyFallbackStocks` is not exported.

- [ ] **Step 3: Wire the provider into the controller**

Create one provider in the controller constructor. Its quote callback updates
stocks case-insensitively and immediately calls `applyRender()`. Its state/error
callbacks log sanitized messages.

Replace `restart()` behavior with:

1. stop the old interval and provider;
2. reload stocks;
3. do one EastMoney fetch for every stock to hydrate names and initial values;
4. start AxData with current A-share codes, URL, token, and configured interval;
5. start the existing interval, whose ticks fetch only the fallback selection.

Keep the trading-time guard for EastMoney polling, but allow the AxData
connection to remain open so it can recover without waiting for a controller
restart. When there are no A-share codes, do not open a WebSocket.

Update `stop()` to close the provider before clearing views.

- [ ] **Step 4: Verify focused behavior**

Run: `npm run compile-tests && npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: all AxData tests PASS.

### Task 4: Full validation and handoff

**Files:**
- Modify only files required to resolve validation failures caused by Tasks 1-3.

**Interfaces:**
- Consumes: completed implementation.
- Produces: a buildable extension with preserved user changes.

- [ ] **Step 1: Run formatting and static checks**

Run: `npx prettier --check src/axdata_quote_provider.ts src/StockBarController.ts src/configuration.ts test/axdata_quote_provider.test.js package.json`

Expected: PASS. If it fails, run Prettier only on the files listed and recheck.

Run: `npm run lint`

Expected: PASS with no ESLint errors.

- [ ] **Step 2: Run compilation and focused tests**

Run: `npm run compile-tests`

Expected: PASS.

Run: `npx mocha --ui tdd test/axdata_quote_provider.test.js`

Expected: PASS.

- [ ] **Step 3: Run production bundling**

Run: `npm run compile`

Expected: Webpack exits successfully and emits `dist/extension.js`.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; the diff contains the user's pre-existing work
plus only the planned AxData files and integrations.
