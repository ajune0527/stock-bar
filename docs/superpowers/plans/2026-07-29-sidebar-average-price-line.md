# Sidebar Average Price Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the source-provided cumulative intraday average price as a distinct line in the sidebar chart.

**Architecture:** Extract EastMoney trend-record parsing into a pure exported function so the fourth field has an explicit `averagePrice` meaning while retaining the old `amount` alias. Extend the existing static Canvas renderer to scale and draw valid average-price points with a compact legend.

**Tech Stack:** TypeScript 4.7, Canvas 2D, Mocha, Webpack.

## Global Constraints

- Use the fourth `trends2/get` field directly; do not calculate VWAP locally.
- Preserve `TrendData.amount` as a compatibility alias equal to `averagePrice`.
- Ignore missing, non-finite, or non-positive average prices when drawing.
- Use a yellow/orange line without area fill and include it in price-axis scaling.
- Do not modify AxData, selection caching, volume bars, or the editor Webview.

---

### Task 1: Explicit average-price parsing

**Files:**
- Modify: `src/eastmoney_provider.ts`
- Modify: `test/sidebar_trend.test.js`

**Interfaces:**
- Produces: `parseTrendRecord(record: string): TrendData | null`
- Extends: `TrendData.averagePrice: number`

- [ ] **Step 1: Write failing parser tests**

Add:

```js
assert.deepEqual(
  parseTrendRecord('2026-07-29 09:31,9.24,15709,9.219'),
  {
    time: '2026-07-29 09:31',
    price: 9.24,
    volume: 15709,
    amount: 9.219,
    averagePrice: 9.219,
  },
);
assert.equal(parseTrendRecord('incomplete,9.24,1'), null);
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: FAIL because `parseTrendRecord` is not exported.

- [ ] **Step 3: Implement parsing and use it in `getTrends`**

Parse the first four comma-separated fields once. Convert price, volume, and
average price to finite numbers or zero. Return `null` for fewer than four
fields. Replace the inline parsing loop with `parseTrendRecord(item)`.

- [ ] **Step 4: Run focused tests**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: parser and existing sidebar tests PASS.

### Task 2: Average-price line, scale, and legend

**Files:**
- Modify: `src/view/stockTrendHtml.ts`
- Modify: `test/sidebar_trend.test.js`

**Interfaces:**
- Consumes: `TrendData.averagePrice` from Task 1.
- Produces: average-price Canvas rendering in `drawChart(state)`.

- [ ] **Step 1: Add failing HTML contract assertions**

Assert the generated HTML contains:

```js
assert.match(html, /point\\.averagePrice/);
assert.match(html, /averagePrices/);
assert.match(html, /averageLineColor/);
assert.match(html, />均价</);
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run compile-tests && npx mocha --ui tdd test/sidebar_trend.test.js`

Expected: FAIL because the renderer has no average-price line.

- [ ] **Step 3: Extend the Canvas renderer**

Collect finite positive `averagePrice` values and include them in the low/high
price calculation. Draw a `#eab308` line after the price area fill and before
the volume separator, skipping invalid points and restarting the path after
gaps. Add a static compact legend containing red/green “现价” and yellow
“均价” indicators without interpolating stock data.

- [ ] **Step 4: Run final verification**

Run:

```bash
npx prettier --check src/eastmoney_provider.ts src/view/stockTrendHtml.ts test/sidebar_trend.test.js
npx eslint src/view/stockTrendHtml.ts
npm run compile-tests
npx mocha --ui tdd test/sidebar_trend.test.js test/axdata_quote_provider.test.js
npm run compile
git diff --check
```

Expected: scoped format/lint, TypeScript, focused tests, Webpack, and diff checks
all exit zero.
