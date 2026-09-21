# Edge 商店链接设计

## 目标

官网首页应反映 Edge 版已正式上线：中文与英文页面中的 Edge 状态改为指向 Microsoft Edge Add-ons 的正式链接。Chrome 继续保持“即将上线 / Coming soon”。

## 页面契约

- Edge 状态元素保留 `class="status"` 与 `data-browser="edge"`，状态值从 `coming-soon` 改为 `available`。
- Edge 元素改为安全的外部链接，目标固定为 `https://microsoftedge.microsoft.com/addons/detail/veilread/ocbckkfiomobcgocladilkofcbbjdjbj`，使用 `target="_blank"` 与 `rel="noreferrer"`。
- 中文文案为“Edge 已上线”，英文文案为“Edge · Available on Microsoft Edge Add-ons”。Chrome 的现有状态和文案不改变。

## 校验与文档

- 发布审计根据浏览器分别验证：Chrome 必须为 coming-soon；Edge 必须为 available、包含正式 URL 和本地化可见文案。
- 单元测试覆盖双语首页、错误的 Edge URL、Edge 错误状态及 Chrome 被误改为 available 的情形。
- 发布手册更新为：审核通过后仅替换相应商店的状态和链接；Chrome 审核通过后再补 Chrome 商店链接。

## 验收

1. 双语产品首页点击 Edge 状态会在新标签页打开正式 Microsoft Edge Add-ons 页面。
2. Chrome 仍显示即将上线，不渲染 Chrome 商店链接。
3. `npm run release:check` 通过，且审计能拒绝缺失或错误的 Edge 链接。
