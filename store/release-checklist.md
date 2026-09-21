# VeilRead 商店发布清单

## 账号准备

- [ ] Chrome Web Store 开发者账号可用。
- [ ] Microsoft Partner Center / Edge Add-ons 账号可用。
- [ ] 仓库 Pages Source 已设置为 GitHub Actions。

## 构建

- [ ] 仅手动修改 `manifest.json` 的版本号，且高于商店已发布版本。
- [ ] 已运行 `npm run release:sync-version`，并提交自动同步的 `package.json` 与 `package-lock.json` 版本元数据。
- [ ] `npm run release:check` 通过。
- [ ] `npm run assets` 后人工检查全部商店图片。
- [ ] `npm run package` 生成唯一发布 ZIP。
- [ ] 同一个 ZIP 已在 Chrome 与 Edge 开发者模式验收。

## Chrome 提交

- [ ] 上传发布 ZIP。
- [ ] 填入中英文 listing、权限理由、隐私问卷和审核说明。
- [ ] 上传 128 图标、宣传图与五张对应语言截图。
- [ ] 填写公开隐私与支持 URL 后提交审核。

## Edge 提交

- [ ] 上传与 Chrome 完全相同的发布 ZIP。
- [ ] 填入中英文 listing、权限理由、隐私问卷和 certification notes。
- [ ] 上传 300 Logo、宣传图与五张对应语言截图。
- [ ] 填写公开隐私与支持 URL 后提交审核。

## 审核后

- [ ] 记录商店版本、提交时间、审核结果和公开链接。
- [ ] 将 Pages 首页的 Coming soon 更新为真实商店链接。
- [ ] 保留发布 ZIP 校验值和对应 Git tag。
