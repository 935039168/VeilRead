# VeilRead 标准化首发流程

本流程适用于 Chrome Web Store 与 Microsoft Edge Add-ons。两家商店始终使用同一份校验通过的 Manifest V3 ZIP，商店上传保持人工提交，不在仓库保存商店密钥。

## 1. 准备干净的发布基线

1. 使用 Node.js 20，并运行 `npm ci` 安装锁定的开发审计依赖。
2. 在主仓库 `master` 上确认计划纳入发布的修改均已提交。
3. 运行 `git status --short`；用户本地目录可以保持未跟踪，但不得进入发布包。
4. 同步远端并确认本地提交历史符合预期。

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
6. 必须完成 A/B/C 跨标签页恢复圆点、单一完整窗体、切页隐藏、导航、service worker 重启、标签关闭和不支持页面的回归矩阵；贴边与原生侧边栏不得出现自由悬浮圆点。

## 5. 部署并检查 GitHub Pages

当前仓库为 Private，当前计划不支持其 Pages，首次创建 Pages site 的 API 请求返回 422，因此站点当前为 404。仓库内的 workflow 使用默认 `GITHUB_TOKEN`，只负责部署已经启用的 Pages；它不能首次启用 Pages，也不得保存 PAT。

1. 仓库所有者选择将仓库改为 Public，或升级到支持 Private Pages 的计划。
2. 满足计划条件后，由维护者在 GitHub 仓库 Pages 设置中把 Source 设为 GitHub Actions；也可使用仓库外的维护者 API 凭据做这一次启用，但不得把令牌写入仓库或 workflow。
3. 重新运行 Pages workflow，确认它成功部署 `site/`。前置条件完成前，workflow 失败和 URL 404 不能报告为已部署。
4. 打开产品、双语隐私、双语支持和权利页面，检查中英文互链与 Issues 地址。

## 6. 人工提交两家商店

1. Chrome Web Store 上传本轮 `dist/` 中的 ZIP，粘贴 `store/listing/`、`store/compliance/` 和 `store/review/` 对应资料并上传素材。
2. Microsoft Edge Add-ons 上传与 Chrome 完全相同的 ZIP，填写对应双语资料和 certification notes。
3. 记录商店、版本、提交时间、ZIP SHA-256 和审核状态。不要把账号凭据或令牌写入仓库。

## 7. 审核通过与回滚

1. 审核通过后，把 Pages 首页的 Coming soon 更新为真实 Chrome 与 Edge 商店链接。
2. 为发布提交建立带说明的 Git tag，例如 `v1.0.0`，并推送该 tag。
3. 保留前一商店版本、ZIP 校验值和历史 Git tag；发生回归时提交修复并递增版本，不删除或重写历史 tag。
