# VeilRead 商店上架资料索引

## 商店文案

- Chrome：[简体中文](listing/chrome-zh-CN.md) · [English](listing/chrome-en.md)
- Edge：[简体中文](listing/edge-zh-CN.md) · [English](listing/edge-en.md)

## 合规资料

- 权限理由：[简体中文](compliance/permissions-zh-CN.md) · [English](compliance/permissions-en.md)
- 隐私问卷：[简体中文](compliance/privacy-questionnaire-zh-CN.md) · [English](compliance/privacy-questionnaire-en.md)
- Chrome 审核说明：[简体中文](review/chrome-notes-zh-CN.md) · [English](review/chrome-notes-en.md)
- Edge 审核说明：[简体中文](review/edge-notes-zh-CN.md) · [English](review/edge-notes-en.md)
- [首次提交与更新清单](release-checklist.md)

## 商店图片

- 最终 PNG：[`assets/generated/`](assets/generated/)
- 可编辑源文件：[`assets/source/`](assets/source/)

Edge 商店 Logo 的源文件 `assets/source/edge-logo-300.png` 为人工维护的 canonical PNG。运行 `npm run assets` 时会原样复制该文件，不会通过浏览器重新渲染或覆盖其内容。需要更换 Logo 时，请有意替换 `assets/source/edge-logo-300.png`，然后运行 `npm run assets`；不要手动编辑 `assets/generated/edge-logo-300.png`。

## 公开页面

- 产品：https://935039168.github.io/VeilRead/
- 隐私：https://935039168.github.io/VeilRead/privacy/zh-CN/ · https://935039168.github.io/VeilRead/privacy/en/
- 支持：https://935039168.github.io/VeilRead/support/zh-CN/ · https://935039168.github.io/VeilRead/support/en/
- 权利：https://935039168.github.io/VeilRead/rights/

## 发布命令

```text
npm run release:sync-version
npm run release:check
npm run assets
npm run package
```

每次发版只手动更新 `manifest.json` 的 `version`，再运行 `npm run release:sync-version` 生成并提交 npm 版本元数据。Chrome 和 Edge 始终上传同一个校验通过的 ZIP；商店上传保持人工操作。

完整步骤见 [标准化首发流程](../docs/releasing.md)，浏览器侧载检查见 [手工验收清单](../docs/manual-acceptance.md)。
