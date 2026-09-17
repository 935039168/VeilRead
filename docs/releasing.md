# VeilRead 标准化首发流程

本流程适用于 Chrome Web Store 与 Microsoft Edge Add-ons。两家商店始终使用同一份校验通过的 Manifest V3 ZIP，商店上传保持人工提交，不在仓库保存商店密钥。

## 1. 准备干净的发布基线

1. 在主仓库 `master` 上确认计划纳入发布的修改均已提交。
2. 运行 `git status --short`；用户本地目录可以保持未跟踪，但不得进入发布包。
3. 同步远端并确认本地提交历史符合预期。

## 2. 更新版本与发布说明

1. 同时修改 `manifest.json` 和 `package.json` 的版本，保持 `MAJOR.MINOR.PATCH` 一致。
2. 商店每次上传都必须使用高于已发布版本的版本号。
3. 检查中英文 listing、隐私政策、权限理由和审核说明是否仍与功能一致。

## 3. 自动验证与商店素材

```text
npm run release:check
npm run assets
npm run release:check
npm run package
```

先运行审计，再生成并人工检查全部 PNG，随后重新审计并生成发布包。`npm run package` 会把 Manifest 版本写入文件名，复查 ZIP 白名单，并输出 SHA-256。

## 4. Chrome 与 Edge 侧载验收

1. 解压 `dist/VeilRead-v1.0.0.zip` 到独立临时目录。
2. 在 Chrome 的扩展管理页打开开发者模式并“加载已解压的扩展程序”。
3. 在 Edge 的扩展管理页打开开发人员模式并加载同一目录。
4. 两款浏览器分别完整执行 [手工验收清单](manual-acceptance.md)。
5. 特别复核全站权限、碰边呼出、冷灰悬浮窗、贴边自动隐藏、侧边栏滚动、TXT、在线书和紧急隐藏。

## 5. 部署并检查 GitHub Pages

1. 在 GitHub 仓库 Pages 设置中将 Source 选为 GitHub Actions。
2. 等待 Pages workflow 成功部署 `site/`。
3. 打开产品、双语隐私、双语支持和权利页面，检查中英文互链与 Issues 地址。

## 6. 人工提交两家商店

1. Chrome Web Store 上传本轮 `dist/` 中的 ZIP，粘贴 `store/listing/`、`store/compliance/` 和 `store/review/` 对应资料并上传素材。
2. Microsoft Edge Add-ons 上传与 Chrome 完全相同的 ZIP，填写对应双语资料和 certification notes。
3. 记录商店、版本、提交时间、ZIP SHA-256 和审核状态。不要把账号凭据或令牌写入仓库。

## 7. 审核通过与回滚

1. 审核通过后，把 Pages 首页的 Coming soon 更新为真实 Chrome 与 Edge 商店链接。
2. 为发布提交建立带说明的 Git tag，例如 `v1.0.0`，并推送该 tag。
3. 保留前一商店版本、ZIP 校验值和历史 Git tag；发生回归时提交修复并递增版本，不删除或重写历史 tag。
