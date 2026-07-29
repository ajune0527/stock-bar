# Sidebar Intraday Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the selected stock's price intraday chart and volume bars in a persistent view beneath the native watchlist Tree View.

**Architecture:** A pure `TrendSelectionModel` owns selection, caching, refresh, and stale-request rejection. A VS Code `StockTrendViewProvider` adapts that state to a static Canvas-based Webview View, while `StockBarController` connects native Tree View selection and live quote updates to the provider.

**Tech Stack:** TypeScript 4.7, VS Code Tree View and Webview View APIs, Canvas 2D, Mocha, Webpack.

## Global Constraints

- Keep the native Tree View, market tabs, drag-and-drop, context menus, and the existing editor Webview.
- Contribute `stockBarTrend` below `stockBarList`; do not open an editor tab.
- Continue using `eastMoneyProvider.getTrends()` for intraday data.
- Draw price in the upper 72% and minute volume bars in the lower 28%, sharing one time axis.
- Use the existing A/HK/US trading-session definitions.
- Quote updates must not refetch intraday data.
- Cache by full EastMoney `secid`, reject stale async responses, and safely serialize all user-visible data.

---

### Task 1: Selection, cache, and stale-request model

**Files:**
- Create: `src/trend_selection_model.ts`
- Create: `test/sidebar_trend.test.js`

**Interfaces:**
- Produces: `TrendStockSnapshot`
- Produces: `TrendViewState`
- Produces: `TrendSelectionModel.select(stock): void`
- Produces: `TrendSelectionModel.refresh(): void`
- Produces: `TrendSelectionModel.syncStocks(stocks): void`
- Produces: `TrendSelectionModel.currentState(): TrendViewState`

- [ ] **Step 1: Write failing model tests**

Test these behaviors with a deferred `fetchTrends(secid)` function:

```js
model.select(stock('600000', '1'));
assert.equal(states.at(-1).status, 'loading');
resolve600000([{ time: '09:30', price: 8.69, volume: 100, amount: 869 }]);
await flushPromises();
assert.equal(states.at(-1).status, 'ready');
assert.equal(states.at(-1).trends[0].volume, 100);
```

Then select the same stock again and assert the fetch count remains one. Select
stock A, then B, resolve A last, and assert A cannot replace B. Call
`syncStocks()` with an updated quote and assert the state changes without a new
fetch. Remove the selected stock from `syncStocks()` and assert `empty`.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: FAIL because `out/trend_selection_model` does not exist.

- [ ] **Step 3: Implement the minimal model**

Use a `Map<string, TrendData[]>`, where the key and requested `secid` are
`${market}.${code}`. Increment a numeric generation on every selection and
refresh. Emit immutable states with statuses `empty`, `loading`, `ready`, and
`error`. A cache hit emits `ready` synchronously. `refresh()` deletes the
current key before loading. `syncStocks()` matches both market and code.

- [ ] **Step 4: Run focused model tests**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: all model tests PASS.

### Task 2: Static sidebar Webview View with price and volume Canvas

**Files:**
- Create: `src/view/stockTrendHtml.ts`
- Create: `src/view/stockTrendView.ts`
- Modify: `test/sidebar_trend.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TrendSelectionModel` and `TrendViewState` from Task 1.
- Produces: `getStockTrendHtml(cspSource: string, nonce: string): string`
- Produces: `StockTrendViewProvider implements vscode.WebviewViewProvider`
- Produces: `StockTrendViewProvider.showStock(stock: Stock): void`
- Produces: `StockTrendViewProvider.syncStocks(stocks: readonly Stock[]): void`

- [ ] **Step 1: Add failing HTML contract tests**

Assert the generated static HTML contains:

```js
assert.match(html, /Content-Security-Policy/);
assert.match(html, /<canvas id="trend-chart"/);
assert.match(html, /point\\.volume/);
assert.match(html, /volumeHeight/);
assert.match(html, /command: 'refresh'/);
```

Also assert the supplied nonce is present on the script element and raw stock
data is not interpolated into the HTML.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: FAIL because `out/view/stockTrendHtml` does not exist.

- [ ] **Step 3: Implement static HTML and Canvas rendering**

Render four states sent through `window.postMessage`: empty guidance, loading,
error with retry button, and ready. Draw a DPR-aware Canvas with:

- a header showing safely assigned `textContent` values;
- price grid, curve, area fill, and dashed previous-close line;
- a separated volume region using `point.volume`;
- red/green volume bars based on each point versus the previous price;
- A/HK/US session-to-offset mapping and shared time labels;
- resize redraw using the most recent state.

Use a nonce-bearing CSP that allows only the Webview source and inline styles
needed for VS Code theme variables. Do not load Tailwind or any remote script.

- [ ] **Step 4: Implement the Webview View provider and contribution**

Add this view after `stockBarList`:

```json
{
    "type": "webview",
    "id": "stockBarTrend",
    "name": "分时图",
    "contextualTitle": "Stock Bar - 分时图"
}
```

In `resolveWebviewView`, enable scripts, assign the static HTML once, forward
model states with `postMessage`, and handle only `{command: "refresh"}`.
Preserve selected model state when VS Code recreates the view.

- [ ] **Step 5: Run focused tests and compilation**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: model and HTML contract tests PASS.

### Task 3: Native Tree selection and live quote integration

**Files:**
- Modify: `src/StockBarController.ts`
- Modify: `src/view/stockTree.ts`
- Modify: `src/view/stockTrendView.ts`
- Modify: `test/sidebar_trend.test.js`

**Interfaces:**
- Consumes: `StockTrendViewProvider` from Task 2.
- Produces: a single click on a stock node updates `stockBarTrend`.

- [ ] **Step 1: Add a failing snapshot-conversion test**

Export and test:

```ts
toTrendStockSnapshot(stock: Stock): TrendStockSnapshot
```

Assert it includes `code`, `market`, `name`, `price`, `updown`, `percent`,
`yestclose`, and `category`, and that `secid` remains `${market}.${code}`.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: FAIL because the conversion is not exported.

- [ ] **Step 3: Connect Tree View selection**

Instantiate `StockTrendViewProvider`, register it with
`window.registerWebviewViewProvider("stockBarTrend", provider, {
  webviewOptions: {retainContextWhenHidden: true}
})`, and subscribe to
`treeView.onDidChangeSelection`. Call `showStock()` only when the first selected
node has `nodeType === "stock"` and a `stock`.

At the end of `applyRender()`, call `provider.syncStocks(this.stocks)` so live
AxData quote changes update the chart header without reloading trends. Dispose
the registration and selection subscription through `context.subscriptions`.

- [ ] **Step 4: Run focused tests and production build**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js test/axdata_quote_provider.test.js`

Expected: all focused tests PASS.

Run: `npm run compile`

Expected: Webpack completes without warnings.

### Task 4: Final validation

**Files:**
- Modify only planned files when resolving validation failures.

**Interfaces:**
- Consumes: complete sidebar chart feature.
- Produces: verified extension output.

- [ ] **Step 1: Run scoped formatting and lint**

Run:

```bash
npx prettier --check src/trend_selection_model.ts src/view/stockTrendHtml.ts src/view/stockTrendView.ts src/StockBarController.ts src/view/stockTree.ts test/sidebar_trend.test.js
npx eslint src/trend_selection_model.ts src/view/stockTrendHtml.ts src/view/stockTrendView.ts src/StockBarController.ts
```

Expected: both commands exit zero.

- [ ] **Step 2: Run compilation, focused tests, and bundle**

Run:

```bash
npm run compile-tests
npx mocha --ui tdd test/sidebar_trend.test.js test/axdata_quote_provider.test.js
npm run compile
```

Expected: TypeScript and Webpack exit zero, with all focused tests passing.

- [ ] **Step 3: Inspect workspace**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors and no changes outside the approved feature,
dependency integration, or the user's pre-existing work.
