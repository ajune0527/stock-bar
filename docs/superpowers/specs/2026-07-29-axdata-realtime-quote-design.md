# AxData A 股实时行情接入设计

## 目标

将 A 股实时行情切换到 AxData 的
`/v1/stream/stock_quote_refresh_tdx` WebSocket。港股、美股、股票搜索和
分时图继续使用东方财富。AxData 不可用或未返回某个代码时，A 股自动回退
到东方财富，并在后台重连。

## 配置

新增以下 VS Code 配置：

- `stock-bar.axDataWebSocketUrl`：默认
  `ws://127.0.0.1:8666/v1/stream/stock_quote_refresh_tdx`。
- `stock-bar.axDataToken`：可选，默认空字符串。非空时作为 URL 的
  `token` 查询参数传给 AxData。

订阅间隔沿用 `stock-bar.updateInterval`，并保证不小于 AxData 的
500 毫秒下限。

## 架构

新增独立的 `AxDataQuoteProvider`，负责：

- 建立和关闭 WebSocket；
- 发送、更新和取消订阅；
- 解析 `snapshot`、`update`、`error` 和连接状态；
- 将 AxData 行情行转换为项目使用的 `Partial<Stock>`；
- 断线后的指数退避重连；
- 向控制器报告已连接、行情更新和错误。

`StockBarController` 继续负责股票集合、数据源协调与渲染。它不解析
WebSocket 协议。

## 数据流

启动或配置变化时：

1. 控制器加载自选股。
2. A 股代码转换为 AxData 的 `CODE.SH` 或 `CODE.SZ` 格式。
3. 提供器连接成功后发送 `subscribe`，请求初始快照和后续更新。
4. 港股和美股继续按原定时器从东方财富更新。
5. A 股名称在启动时由东方财富补充；实时价格以 AxData 为主。
6. 收到 AxData 行情后更新对应 `Stock` 并渲染所有视图。

字段映射：

| AxData | Stock |
| --- | --- |
| `symbol` 或 `instrument_id` | `code` |
| `last_price` | `price` |
| `pre_close` | `yestclose` |
| `change` | `updown` |
| `change_pct` | `percent`，除以 100 |
| `open` | `open` |
| `high` | `high` |
| `low` | `low` |

## 回退与恢复

- WebSocket 尚未建立、断开或报告错误时，定时器使用东方财富更新所有股票。
- WebSocket 正常时，定时器只用东方财富更新港股、美股，以及 AxData
  初始快照未覆盖的 A 股代码。
- 提供器使用有上限的指数退避重连；连接恢复后自动重新订阅当前代码。
- 新的 AxData 数据到达后立即接管对应 A 股，停止其轮询回退。
- `stop`、插件销毁和重启订阅时取消旧连接及重连计时器。

此策略也覆盖 AxData 股票流不支持的指数代码。

## 错误处理

- 无效 JSON、未知事件和空更新不会破坏现有行情。
- 单条无效行情被忽略并记录日志，其余有效行仍正常处理。
- Token 通过 URL 查询参数传递，但日志不得输出包含 Token 的完整 URL。
- 用户手动停止时不得触发自动重连。

## 测试与验证

- 单元测试覆盖代码转换、Token URL、订阅消息、字段转换和百分比单位。
- 使用可控的 WebSocket 测试替身覆盖连接、消息、关闭、重连和主动停止。
- 控制器测试或等价的提供器状态测试覆盖 AxData 缺失代码时的回退选择。
- 运行 TypeScript 编译、lint 和现有测试，确认不破坏当前未提交的市场分类、
  Tab、拖拽排序和分时图改动。

## 非目标

- 不替换东方财富搜索和分时图接口。
- 不为港股、美股增加新的实时数据源。
- 不重构为通用多数据源插件框架。
- 不修改 AxData 服务端协议。
