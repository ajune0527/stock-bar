/**
 * WebView 面板 - 股票详情查看
 * 支持 VS Code 主题切换
 */

import * as vscode from 'vscode';
import Configuration from '../configuration';
import { eastMoneyProvider, TrendData } from '../eastmoney_provider';
import Stock from '../stock';

export class StockWebView {
	private panel: vscode.WebviewPanel | null = null;
	private stocks: Stock[] = [];
	private refreshCallback?: () => void;
	private trendsCache: Map<string, TrendData[]> = new Map();

	constructor() {}

	onRefresh(callback: () => void): void {
		this.refreshCallback = callback;
	}

	updateStocks(stocks: Stock[]): void {
		this.stocks = stocks;
		if (this.panel) {
			this.updateWebview();
		}
	}

	show(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One);
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			'stockBarWebView',
			'自选股详情',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			},
		);

		this.panel.webview.html = this.getWebviewContent();

		this.panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'delete') {
				await this.deleteStock(message.code);
			} else if (message.command === 'refresh') {
				this.refreshCallback?.();
			} else if (message.command === 'getTrends') {
				await this.sendTrendsData(message.code);
			}
		});

		this.panel.onDidDispose(() => {
			this.panel = null;
		});
	}

	private async sendTrendsData(code: string): Promise<void> {
		const stock = this.stocks.find(s => s.code === code);
		if (!stock) {
			return;
		}

		try {
			const trends = await eastMoneyProvider.getTrends(stock.getSecid());
			this.trendsCache.set(code, trends);
			this.panel?.webview.postMessage({
				command: 'trendsData',
				code,
				data: trends,
				yestclose: stock.yestclose,
			});
		} catch (error) {
			console.error('[StockBar] Failed to get trends:', error);
		}
	}

	private updateWebview(): void {
		if (this.panel) {
			this.panel.webview.html = this.getWebviewContent();
		}
	}

	private async deleteStock(code: string): Promise<void> {
		const currentStocks = Configuration.getStocks() || [];
		const newStocks = currentStocks.filter(
			(item) => item.code !== code,
		);

		await Configuration.stockBarConfig().update(
			'stocks',
			newStocks,
			vscode.ConfigurationTarget.Global,
		);

		vscode.window.showInformationMessage('已删除：' + code);
		this.refreshCallback?.();
	}

	private getWebviewContent(): string {
		const stockData = this.stocks.map((stock) => ({
			name: stock.name || stock.code,
			code: stock.code,
			secid: stock.getSecid(),
			price: stock.price.toFixed(2),
			percent: stock.percent >= 0
				? '+' + (stock.percent * 100).toFixed(2) + '%'
				: (stock.percent * 100).toFixed(2) + '%',
			yestclose: stock.yestclose.toFixed(2),
			isRise: stock.percent >= 0,
		}));

		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>自选股详情</title>
	<script src="https://cdn.tailwindcss.com"></script>
	<script>
		tailwind.config = {
			darkMode: 'class',
			theme: {
				extend: {
					colors: {
						rise: '#ef4444',
						fall: '#22c55e',
					}
				}
			}
		}
	</script>
	<style>
		body {
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
		}
		.btn-primary {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.btn-primary:hover {
			background-color: var(--vscode-button-hoverBackground);
		}
		.btn-danger {
			background-color: var(--vscode-inputValidation-errorBackground, #be1100);
			color: var(--vscode-inputValidation-errorForeground, #fff);
		}
		.table-header {
			background-color: var(--vscode-editor-lineHighlightBackground, rgba(0,0,0,0.1));
		}
		.table-row:hover {
			background-color: var(--vscode-list-hoverBackground, rgba(0,0,0,0.05));
		}
		.border-color {
			border-color: var(--vscode-panel-border, rgba(128,128,128,0.35));
		}
		.trend-row {
			background-color: var(--vscode-editor-background);
		}
		.trend-canvas {
			background-color: var(--vscode-editor-background);
		}
	</style>
</head>
<body class="min-h-screen p-6">
	<div class="max-w-6xl mx-auto">
		<div class="flex items-center justify-between mb-6">
			<h1 class="text-2xl font-bold flex items-center gap-2">
				<span>📈</span>
			</h1>
		</div>

		<div class="rounded-lg overflow-hidden border border-color">
			${
				this.stocks.length === 0
					? `<div class="p-12 text-center opacity-60">
						 <p class="text-lg">暂无自选股</p>
						 <p class="text-sm mt-2">请使用命令面板添加股票</p>
					   </div>`
					: `<table class="w-full">
						 <thead>
							 <tr class="table-header">
								 <th class="px-4 py-3 text-left font-medium">股票</th>
								 <th class="px-4 py-3 text-right font-medium">现价</th>
								 <th class="px-4 py-3 text-right font-medium">涨跌幅</th>
								 <th class="px-4 py-3 text-right font-medium">昨收</th>
								 <th class="px-4 py-3 text-center font-medium">操作</th>
							 </tr>
						 </thead>
						 <tbody>
							 ${stockData.map((stock) => `
								 <tr class="table-row border-t border-color">
									 <td class="px-4 py-3">
										 <div class="font-medium">${stock.name}</div>
										 <div class="text-xs opacity-60">${stock.code}</div>
									 </td>
									 <td class="px-4 py-3 text-right font-mono ${stock.isRise ? 'text-rise' : 'text-fall'}">
										 ${stock.price}
										 <span class="ml-1">${stock.isRise ? '↑' : '↓'}</span>
									 </td>
									 <td class="px-4 py-3 text-right font-mono font-medium ${stock.isRise ? 'text-rise' : 'text-fall'}">
										 ${stock.percent}
									 </td>
									 <td class="px-4 py-3 text-right font-mono opacity-70">${stock.yestclose}</td>
									 <td class="px-4 py-3 text-center">
										 <button
											 onclick="toggleTrend('${stock.code}')"
											 class="btn-primary px-2 py-1 rounded text-xs font-medium transition-colors hover:opacity-80 mr-1"
											 title="展开/折叠分时图"
										 >
											 <span id="toggle-icon-${stock.code}">▶</span>
										 </button>
										 <button
											 onclick="deleteStock('${stock.code}')"
											 class="btn-danger px-3 py-1 rounded text-sm font-medium transition-colors hover:opacity-80"
										 >
											 删除
										 </button>
									 </td>
								 </tr>
								 <tr id="trend-row-${stock.code}" class="trend-row border-t border-color hidden">
									 <td colspan="5" class="p-2">
										 <canvas id="chart-${stock.code}" class="trend-canvas w-full" height="100" data-code="${stock.code}" data-yestclose="${stock.yestclose}"></canvas>
									 </td>
								 </tr>
							 `).join('')}
						 </tbody>
					   </table>`
			}
		</div>

		<div class="mt-6 text-sm opacity-50 text-center">
			共 ${this.stocks.length} 只股票
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		const trendsCache = {};

		// 检测 VS Code 主题
		function updateTheme() {
			const isDark = document.body.classList.contains('vscode-dark') ||
						   window.matchMedia('(prefers-color-scheme: dark)').matches;
			document.documentElement.classList.toggle('dark', isDark);
		}

		// 初始化主题
		updateTheme();

		// 监听主题变化
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);

		// 删除股票
		function deleteStock(code) {
			vscode.postMessage({ command: 'delete', code: code });
		}

		// 刷新数据
		function refresh() {
			vscode.postMessage({ command: 'refresh' });
		}

		// 切换分时图显示
		const expandedStocks = new Set();

		function toggleTrend(code) {
			const row = document.getElementById('trend-row-' + code);
			const icon = document.getElementById('toggle-icon-' + code);

			if (expandedStocks.has(code)) {
				// 折叠
				expandedStocks.delete(code);
				row.classList.add('hidden');
				icon.textContent = '▶';
			} else {
				// 展开
				expandedStocks.add(code);
				row.classList.remove('hidden');
				icon.textContent = '▼';

				// 如果还没有加载分时数据，则加载
				if (!trendsCache[code]) {
					const canvas = document.getElementById('chart-' + code);
					if (canvas) {
						const yestclose = parseFloat(canvas.dataset.yestclose);
						drawTrendChart(canvas, [], yestclose);
						requestTrends(code);
					}
				} else {
					// 重绘已有数据
					const canvas = document.getElementById('chart-' + code);
					if (canvas) {
						const yestclose = parseFloat(canvas.dataset.yestclose);
						drawTrendChart(canvas, trendsCache[code], yestclose);
					}
				}
			}
		}

		// 绘制分时图
		function drawTrendChart(canvas, trends, yestclose) {
			const ctx = canvas.getContext('2d');
			const dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();

			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			ctx.scale(dpr, dpr);

			const width = rect.width;
			const height = rect.height;
			const padding = { top: 5, right: 10, bottom: 15, left: 45 };
			const chartWidth = width - padding.left - padding.right;
			const chartHeight = height - padding.top - padding.bottom;

			// 清空画布
			ctx.clearRect(0, 0, width, height);

			if (!trends || trends.length === 0) {
				ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
				ctx.font = '11px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText('加载中...', width / 2, height / 2);
				return;
			}

			// 交易时间段: 09:30-11:30 (120分钟), 13:00-15:00 (120分钟)
			// 总交易时间: 240分钟
			const totalMinutes = 240;
			const morningEnd = 120; // 上午结束位置
			const afternoonStart = 120; // 下午开始位置

			// 将时间字符串转换为交易分钟数
			function timeToMinutes(timeStr) {
				// 格式: "2026-04-24 09:30" 或 "09:30"
				const timePart = timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr;
				const [hour, minute] = timePart.split(':').map(Number);
				const totalMins = hour * 60 + minute;

				// 09:30 = 0, 11:30 = 120, 13:00 = 120, 15:00 = 240
				if (totalMins <= 11 * 60 + 30) {
					// 上午: 09:30 - 11:30
					return Math.max(0, totalMins - (9 * 60 + 30));
				} else {
					// 下午: 13:00 - 15:00
					return Math.min(totalMinutes, morningEnd + (totalMins - 13 * 60));
				}
			}

			// 将交易分钟数转换为X坐标
			function minutesToX(minutes) {
				return padding.left + (minutes / totalMinutes) * chartWidth;
			}

			// 计算价格范围
			const prices = trends.map(t => t.price);
			const minPrice = Math.min(...prices, yestclose);
			const maxPrice = Math.max(...prices, yestclose);
			const priceRange = maxPrice - minPrice || 1;
			const pricePadding = priceRange * 0.1;
			const actualMin = minPrice - pricePadding;
			const actualMax = maxPrice + pricePadding;
			const actualRange = actualMax - actualMin;

			// 获取主题颜色
			const isDark = document.documentElement.classList.contains('dark');
			const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
			const textColor = isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)';
			const riseColor = '#ef4444';
			const fallColor = '#22c55e';

			// 判断涨跌
			const lastPrice = prices[prices.length - 1];
			const isRise = lastPrice >= yestclose;
			const lineColor = isRise ? riseColor : fallColor;

			// 绘制网格
			ctx.strokeStyle = gridColor;
			ctx.lineWidth = 1;

			// 横向网格线
			for (let i = 0; i <= 4; i++) {
				const y = padding.top + (chartHeight / 4) * i;
				ctx.beginPath();
				ctx.moveTo(padding.left, y);
				ctx.lineTo(width - padding.right, y);
				ctx.stroke();

				// 价格标签
				const price = actualMax - (actualRange / 4) * i;
				ctx.fillStyle = textColor;
				ctx.font = '9px sans-serif';
				ctx.textAlign = 'right';
				ctx.fillText(price.toFixed(2), padding.left - 4, y + 3);
			}

			// 昨收价线
			const yestcloseY = padding.top + ((actualMax - yestclose) / actualRange) * chartHeight;
			ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)';
			ctx.setLineDash([3, 3]);
			ctx.beginPath();
			ctx.moveTo(padding.left, yestcloseY);
			ctx.lineTo(width - padding.right, yestcloseY);
			ctx.stroke();
			ctx.setLineDash([]);

			// 绘制价格曲线
			ctx.strokeStyle = lineColor;
			ctx.lineWidth = 1.5;
			ctx.beginPath();

			const lastX = minutesToX(timeToMinutes(trends[trends.length - 1].time));

			trends.forEach((trend, index) => {
				const minutes = timeToMinutes(trend.time);
				const x = minutesToX(minutes);
				const y = padding.top + ((actualMax - trend.price) / actualRange) * chartHeight;

				if (index === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			});
			ctx.stroke();

			// 绘制填充区域
			ctx.lineTo(lastX, padding.top + chartHeight);
			ctx.lineTo(padding.left, padding.top + chartHeight);
			ctx.closePath();

			const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
			if (isRise) {
				gradient.addColorStop(0, 'rgba(239, 68, 68, 0.3)');
				gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
			} else {
				gradient.addColorStop(0, 'rgba(34, 197, 94, 0.3)');
				gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
			}
			ctx.fillStyle = gradient;
			ctx.fill();

			// 时间标签 - 固定显示关键时间点
			ctx.fillStyle = textColor;
			ctx.font = '9px sans-serif';
			ctx.textAlign = 'center';

			const timeLabels = ['09:30', '11:30', '13:00', '15:00'];
			const timeMinutes = [0, 120, 120, 240];

			timeLabels.forEach((label, i) => {
				const x = minutesToX(timeMinutes[i]);
				ctx.fillText(label, x, height - 3);
			});
		}

		// 请求分时数据
		function requestTrends(code) {
			vscode.postMessage({ command: 'getTrends', code: code });
		}

		// 接收分时数据
		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.command === 'trendsData') {
				trendsCache[message.code] = message.data;
				const canvas = document.getElementById('chart-' + message.code);
				if (canvas) {
					drawTrendChart(canvas, message.data, message.yestclose);
				}
			}
		});

		// 初始化 - 默认折叠，不自动加载分时数据
		function initCharts() {
			// 分时图默认折叠，点击展开时才加载数据
		}

		// 页面加载完成后初始化
		document.addEventListener('DOMContentLoaded', initCharts);

		// 窗口大小变化时重绘
		window.addEventListener('resize', () => {
			Object.keys(trendsCache).forEach(code => {
				const canvas = document.getElementById('chart-' + code);
				if (canvas) {
					const yestclose = parseFloat(canvas.dataset.yestclose);
					drawTrendChart(canvas, trendsCache[code], yestclose);
				}
			});
		});
	</script>
</body>
</html>`;
	}
}
