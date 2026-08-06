function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function getStockTrendHtml(cspSource: string, nonce: string): string {
	const safeCspSource = escapeAttribute(cspSource);
	const safeNonce = escapeAttribute(nonce);
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta
		http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${safeCspSource} 'unsafe-inline'; script-src 'nonce-${safeNonce}';"
	>
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		:root { color-scheme: light dark; }
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 8px;
			height: 100vh;
			overflow: hidden;
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		#root { display: flex; flex-direction: column; height: 100%; min-height: 120px; }
		.header { display: none; align-items: center; gap: 8px; min-height: 30px; }
		.identity { min-width: 0; flex: 1; }
		.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
		.code { color: var(--vscode-descriptionForeground); font-size: 11px; }
		.quote { text-align: right; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
		.price { font-weight: 600; }
		.change { margin-left: 5px; font-size: 11px; }
		.rise { color: #ef4444; }
		.fall { color: #22c55e; }
		button {
			border: 0;
			border-radius: 3px;
			padding: 3px 7px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		.chart-wrap { position: relative; flex: 1; min-height: 0; margin-top: 5px; }
		.legend {
			position: absolute;
			top: 1px;
			left: 46px;
			z-index: 1;
			display: none;
			gap: 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 10px;
			pointer-events: none;
		}
		.legend-item { display: inline-flex; align-items: center; gap: 3px; }
		.legend-line { display: inline-block; width: 12px; height: 2px; }
		.average-legend-line { background: #eab308; }
		#trend-chart { display: none; width: 100%; height: 100%; }
		.message {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 12px;
			text-align: center;
			color: var(--vscode-descriptionForeground);
		}
		.message-content { max-width: 260px; }
		#error-detail { margin-bottom: 8px; }
	</style>
</head>
<body>
	<div id="root">
		<div id="header" class="header">
			<div class="identity">
				<div id="stock-name" class="name"></div>
				<div id="stock-code" class="code"></div>
			</div>
			<div id="quote" class="quote">
				<span id="stock-price" class="price"></span>
				<span id="stock-change" class="change"></span>
			</div>
			<button id="refresh" title="刷新分时数据">↻</button>
		</div>
		<div class="chart-wrap">
			<div id="legend" class="legend">
				<span class="legend-item">
					<i id="price-legend-line" class="legend-line"></i><b>现价</b>
				</span>
				<span class="legend-item">
					<i class="legend-line average-legend-line"></i><b>均价</b>
				</span>
			</div>
			<canvas id="trend-chart"></canvas>
			<div id="message" class="message">
				<div class="message-content">
					<div id="message-text">点击上方个股查看分时图</div>
					<div id="error-detail"></div>
					<button id="retry" style="display:none">重试</button>
				</div>
			</div>
		</div>
	</div>
	<script nonce="${safeNonce}">
		const vscode = acquireVsCodeApi();
		const canvas = document.getElementById('trend-chart');
		const context = canvas.getContext('2d');
		const header = document.getElementById('header');
		const message = document.getElementById('message');
		const messageText = document.getElementById('message-text');
		const errorDetail = document.getElementById('error-detail');
		const retry = document.getElementById('retry');
		const refresh = document.getElementById('refresh');
		const legend = document.getElementById('legend');
		const priceLegendLine = document.getElementById('price-legend-line');
		let currentState = null;

		const AXIS_CONFIG = {
			A: { total: 240, sessions: [[570, 690], [780, 900]] },
			HK: { total: 330, sessions: [[570, 720], [780, 960]] },
			US: { total: 390, sessions: [[570, 960]] },
		};

		function postRefresh() {
			vscode.postMessage({ command: 'refresh' });
		}
		refresh.addEventListener('click', postRefresh);
		retry.addEventListener('click', postRefresh);

		function setText(id, value) {
			document.getElementById(id).textContent = value;
		}

		function formatNumber(value, digits) {
			return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--';
		}

		function renderState(state) {
			currentState = state;
			const stock = state && state.stock;
			header.style.display = stock ? 'flex' : 'none';
			if (stock) {
				setText('stock-name', stock.name || stock.code);
				setText('stock-code', stock.code);
				setText('stock-price', formatNumber(stock.price, 2));
				const sign = stock.updown >= 0 ? '+' : '';
				setText(
					'stock-change',
					sign + formatNumber(stock.updown, 2) + '  ' +
						sign + formatNumber(stock.percent * 100, 2) + '%',
				);
				const quote = document.getElementById('quote');
				quote.classList.toggle('rise', stock.updown >= 0);
				quote.classList.toggle('fall', stock.updown < 0);
				priceLegendLine.style.background = stock.updown >= 0 ? '#ef4444' : '#22c55e';
			}

			canvas.style.display = 'none';
			legend.style.display = 'none';
			message.style.display = 'flex';
			retry.style.display = 'none';
			errorDetail.textContent = '';
			if (!state || state.status === 'empty') {
				messageText.textContent = '点击上方个股查看分时图';
				return;
			}
			if (state.status === 'loading') {
				messageText.textContent = '正在加载分时数据…';
				return;
			}
			if (state.status === 'error') {
				messageText.textContent = '分时数据加载失败';
				errorDetail.textContent = state.error || '';
				retry.style.display = 'inline-block';
				return;
			}
			if (!state.trends || state.trends.length === 0) {
				messageText.textContent = '暂无分时数据';
				return;
			}
			message.style.display = 'none';
			canvas.style.display = 'block';
			legend.style.display = 'flex';
			drawChart(state);
		}

		function parseMinutes(timeValue) {
			const text = String(timeValue || '');
			const time = text.includes(' ') ? text.split(' ')[1] : text;
			const parts = time.split(':').map(Number);
			return parts[0] * 60 + parts[1];
		}

		function timeToOffset(category, timeValue) {
			const config = AXIS_CONFIG[category] || AXIS_CONFIG.A;
			const minutes = parseMinutes(timeValue);
			let offset = 0;
			for (const session of config.sessions) {
				const start = session[0];
				const end = session[1];
				if (minutes <= end) {
					return Math.max(0, Math.min(config.total, offset + minutes - start));
				}
				offset += end - start;
			}
			return config.total;
		}

		function timeLabel(minutes) {
			const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
			const minute = String(minutes % 60).padStart(2, '0');
			return hour + ':' + minute;
		}

		function cssColor(variable, fallback) {
			return getComputedStyle(document.body).getPropertyValue(variable).trim() || fallback;
		}

		function drawChart(state) {
			const rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.round(rect.width * dpr);
			canvas.height = Math.round(rect.height * dpr);
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, rect.width, rect.height);

			const width = rect.width;
			const height = rect.height;
			const padding = { left: 42, right: 7, top: 17, bottom: 17 };
			const plotWidth = Math.max(1, width - padding.left - padding.right);
			const plotHeight = Math.max(1, height - padding.top - padding.bottom);
			const priceHeight = Math.max(40, plotHeight * 0.68);
			const gap = 8;
			const volumeHeight = Math.max(18, plotHeight - priceHeight - gap);
			const volumeTop = padding.top + priceHeight + gap;
			const trends = state.trends;
			const previousClose = Number(state.stock.yestclose) || 0;
			const prices = trends.map((point) => Number(point.price)).filter(Number.isFinite);
			const averagePrices = trends
				.map((point) => Number(point.averagePrice))
				.filter((price) => Number.isFinite(price) && price > 0);
			if (prices.length === 0) return;
			const low = Math.min(
				previousClose || prices[0],
				...prices,
				...averagePrices,
			);
			const high = Math.max(
				previousClose || prices[0],
				...prices,
				...averagePrices,
			);
			const range = high - low || Math.max(Math.abs(high) * 0.01, 1);
			const priceMin = low - range * 0.08;
			const priceMax = high + range * 0.08;
			const priceRange = priceMax - priceMin;
			const volumes = trends.map((point) => Math.max(0, Number(point.volume) || 0));
			const maxVolume = Math.max(1, ...volumes);
			const axis = AXIS_CONFIG[state.stock.category] || AXIS_CONFIG.A;
			const grid = cssColor('--vscode-panel-border', 'rgba(128,128,128,.28)');
			const text = cssColor('--vscode-descriptionForeground', '#888');
			const rise = '#ef4444';
			const fall = '#22c55e';
			const averageLineColor = '#eab308';
			const line = state.stock.updown >= 0 ? rise : fall;
			const xFor = (point) =>
				padding.left +
				(timeToOffset(state.stock.category, point.time) / axis.total) * plotWidth;
			const yFor = (price) =>
				padding.top + ((priceMax - price) / priceRange) * priceHeight;

			context.strokeStyle = grid;
			context.fillStyle = text;
			context.font = '9px sans-serif';
			context.textAlign = 'right';
			context.lineWidth = 1;
			for (let index = 0; index <= 3; index += 1) {
				const y = padding.top + (priceHeight / 3) * index;
				context.beginPath();
				context.moveTo(padding.left, y);
				context.lineTo(width - padding.right, y);
				context.stroke();
				const value = priceMax - (priceRange / 3) * index;
				context.fillText(value.toFixed(2), padding.left - 4, y + 3);
			}

			if (previousClose > 0) {
				const previousY = yFor(previousClose);
				context.save();
				context.setLineDash([3, 3]);
				context.strokeStyle = text;
				context.beginPath();
				context.moveTo(padding.left, previousY);
				context.lineTo(width - padding.right, previousY);
				context.stroke();
				context.restore();
			}

			context.strokeStyle = line;
			context.lineWidth = 1.5;
			context.beginPath();
			trends.forEach((point, index) => {
				const x = xFor(point);
				const y = yFor(Number(point.price));
				if (index === 0) context.moveTo(x, y);
				else context.lineTo(x, y);
			});
			context.stroke();

			const lastPoint = trends[trends.length - 1];
			const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + priceHeight);
			gradient.addColorStop(0, state.stock.updown >= 0 ? 'rgba(239,68,68,.22)' : 'rgba(34,197,94,.22)');
			gradient.addColorStop(1, 'rgba(0,0,0,0)');
			context.lineTo(xFor(lastPoint), padding.top + priceHeight);
			context.lineTo(xFor(trends[0]), padding.top + priceHeight);
			context.closePath();
			context.fillStyle = gradient;
			context.fill();

			let averagePathStarted = false;
			let validAverageCount = 0;
			let onlyAveragePoint = null;
			context.strokeStyle = averageLineColor;
			context.lineWidth = 1.25;
			context.beginPath();
			trends.forEach((point) => {
				const averagePrice = Number(point.averagePrice);
				if (!Number.isFinite(averagePrice) || averagePrice <= 0) {
					averagePathStarted = false;
					return;
				}
				const x = xFor(point);
				const y = yFor(averagePrice);
				if (averagePathStarted) context.lineTo(x, y);
				else context.moveTo(x, y);
				averagePathStarted = true;
				validAverageCount += 1;
				onlyAveragePoint = { x, y };
			});
			context.stroke();
			if (validAverageCount === 1 && onlyAveragePoint) {
				context.fillStyle = averageLineColor;
				context.beginPath();
				context.arc(onlyAveragePoint.x, onlyAveragePoint.y, 1.75, 0, Math.PI * 2);
				context.fill();
			}

			context.strokeStyle = grid;
			context.beginPath();
			context.moveTo(padding.left, volumeTop - gap / 2);
			context.lineTo(width - padding.right, volumeTop - gap / 2);
			context.stroke();

			const barWidth = Math.max(1, Math.min(5, plotWidth / Math.max(trends.length, 1) * 0.72));
			trends.forEach((point, index) => {
				const priorPrice = index === 0 ? previousClose : Number(trends[index - 1].price);
				context.fillStyle = Number(point.price) >= priorPrice ? rise : fall;
				const barHeight = (Math.max(0, Number(point.volume) || 0) / maxVolume) * volumeHeight;
				context.fillRect(
					xFor(point) - barWidth / 2,
					volumeTop + volumeHeight - barHeight,
					barWidth,
					barHeight,
				);
			});

			context.fillStyle = text;
			context.textAlign = 'center';
			const labels = [{ text: timeLabel(axis.sessions[0][0]), offset: 0 }];
			if (axis.sessions.length > 1) {
				const firstDuration = axis.sessions[0][1] - axis.sessions[0][0];
				labels.push({
					text: timeLabel(axis.sessions[0][1]) + '/' + timeLabel(axis.sessions[1][0]),
					offset: firstDuration,
				});
			}
			labels.push({
				text: timeLabel(axis.sessions[axis.sessions.length - 1][1]),
				offset: axis.total,
			});
			labels.forEach((label) => {
				const x = padding.left + (label.offset / axis.total) * plotWidth;
				context.fillText(label.text, x, height - 3);
			});
		}

		window.addEventListener('message', (event) => {
			if (event.data && event.data.type === 'trendState') {
				renderState(event.data.state);
			}
		});
		window.addEventListener('resize', () => {
			if (currentState && currentState.status === 'ready') {
				drawChart(currentState);
			}
		});
		vscode.postMessage({ command: 'ready' });
	</script>
</body>
</html>`;
}
