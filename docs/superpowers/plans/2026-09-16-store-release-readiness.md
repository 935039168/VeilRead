# VeilRead Store Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 VeilRead 整理成可重复校验、可生成同一 Chrome/Edge 发布包，并具备双语商店资料、公开合规页面和完整商店图片物料的首发仓库。

**Architecture:** 运行代码继续保持无框架、无构建的 Manifest V3 结构；发布工具集中放在 `tools/release/`，使用 Node.js 标准库完成静态审计、PNG 校验和确定性 ZIP 打包。商店文档放在 `store/`，公开页面放在 `site/`，素材以可编辑 HTML/CSS/SVG 为源并通过本机 Chromium 无头渲染为 PNG；CI 只验证仓库和部署 Pages，商店上传保持人工操作。

**Tech Stack:** Manifest V3、原生 JavaScript、Node.js 20 标准库与 `node:test`、HTML/CSS/SVG、Chrome/Edge headless、GitHub Actions、GitHub Pages。

---

## 文件结构与职责

- `_locales/zh_CN/messages.json`、`_locales/en/messages.json`：浏览器可见名称与简介。
- `tools/release/config.js`：运行包白名单、权限键、商店物料规格和公开 URL 的单一事实来源。
- `tools/release/audit.js`：可复用的 Manifest、locale、权限、远程代码、文档和 PNG 校验函数。
- `tools/release/check.js`：命令行审计入口。
- `tools/release/zip.js`：仅使用 Node 标准库的 ZIP 写入与目录读取。
- `tools/release/package.js`：先校验再按白名单生成并复查发布 ZIP。
- `tools/release/render-assets.js`：寻找本机 Chrome/Edge，以固定视口渲染商店 PNG。
- `test/unit/release-audit.test.js`、`test/unit/release-package.test.js`：发布校验和打包器回归测试。
- `test/store-assets.html`、`test/store-assets.js`、`test/store-assets.css`：调用真实扩展 CSS/阅读器代码构建可重复截图场景。
- `store/listing/`、`store/compliance/`、`store/review/`：双语商店文案、问卷答案、权限理由和审核说明。
- `store/assets/source/`：可编辑的宣传图与截图框架源文件。
- `store/assets/generated/`：提交商店的最终 PNG。
- `site/`：无需构建的 GitHub Pages 产品、隐私、支持和权利页面。
- `.github/workflows/ci.yml`、`.github/workflows/pages.yml`：持续验证与静态站点部署。

### Task 1: Manifest 双语元数据与版本一致性

**Files:**
- Create: `_locales/zh_CN/messages.json`
- Create: `_locales/en/messages.json`
- Create: `test/unit/release-audit.test.js`
- Create: `tools/release/config.js`
- Create: `tools/release/audit.js`
- Modify: `manifest.json:1-7`

- [ ] **Step 1: 写入会失败的 Manifest 与 locale 测试**

在 `test/unit/release-audit.test.js` 中加载仓库根目录，断言：Manifest 为 MV3；`package.json` 与 Manifest 均为 `1.0.0`；`default_locale` 为 `zh_CN`；名称和简介分别为 `__MSG_extensionName__`、`__MSG_extensionDescription__`；两个 locale 都包含非空的 `extensionName` 与 `extensionDescription`。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { auditManifestAndLocales } = require('../../tools/release/audit.js');

const root = path.resolve(__dirname, '../..');

test('manifest metadata is localized and versions stay aligned', () => {
  assert.deepEqual(auditManifestAndLocales(root), []);
});
```

- [ ] **Step 2: 运行测试并确认它因缺少审计模块或 locale 失败**

Run: `node --test test/unit/release-audit.test.js`

Expected: FAIL，错误明确指向 `tools/release/audit.js` 或 `_locales` 尚不存在。

- [ ] **Step 3: 实现 Manifest 与 locale 校验**

`tools/release/config.js` 导出以下固定配置：

```js
'use strict';
module.exports = Object.freeze({
  locales: ['zh_CN', 'en'],
  permissionKeys: ['storage', 'unlimitedStorage', 'sidePanel', 'contextMenus', 'scripting', 'http://*/*', 'https://*/*'],
  publicUrls: Object.freeze({
    home: 'https://935039168.github.io/VeilRead/',
    privacyZh: 'https://935039168.github.io/VeilRead/privacy/zh-CN/',
    privacyEn: 'https://935039168.github.io/VeilRead/privacy/en/',
    supportZh: 'https://935039168.github.io/VeilRead/support/zh-CN/',
    supportEn: 'https://935039168.github.io/VeilRead/support/en/',
    rights: 'https://935039168.github.io/VeilRead/rights/',
  }),
});
```

`auditManifestAndLocales(root)` 返回字符串错误数组而不是直接退出。它读取 JSON、比较版本、校验 `/^\d+\.\d+\.\d+$/`，展开 `__MSG_key__` 并检查所有 locale 的 `message` 为非空字符串。

- [ ] **Step 4: 写入中英文消息并切换 Manifest 引用**

中文固定为 `VeilRead` / `轻量、可定制、注重本地隐私的网页与小说阅读器。`；英文固定为 `VeilRead` / `A lightweight, customizable, privacy-conscious reader for web pages and novels.`。在 Manifest 加入 `"default_locale": "zh_CN"`，并把 `name`、`description` 改为消息引用；权限和匹配范围保持不变。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test && npm run check`

Expected: 全部测试 PASS，语法检查退出码为 0。

```bash
git add manifest.json _locales tools/release/config.js tools/release/audit.js test/unit/release-audit.test.js
git commit -m "feat: localize extension metadata"
```

### Task 2: 权利声明与双语公开站点

**Files:**
- Create: `RIGHTS.md`
- Create: `site/index.html`
- Create: `site/styles.css`
- Create: `site/privacy/zh-CN/index.html`
- Create: `site/privacy/en/index.html`
- Create: `site/support/zh-CN/index.html`
- Create: `site/support/en/index.html`
- Create: `site/rights/index.html`
- Modify: `test/unit/release-audit.test.js`
- Modify: `tools/release/audit.js`

- [ ] **Step 1: 增加会失败的公开页面完整性测试**

新增 `auditPublicSite(root)` 断言，要求六个公开 URL 对应文件存在；每个 HTML 有 UTF-8 charset、viewport、返回首页链接和中英文切换；隐私页含 `2026-09-16`、本地存储、网页解析、同站请求、无广告/遥测/分析/出售/跨站跟踪、卸载清理和 Issues 支持地址。

- [ ] **Step 2: 运行定向测试确认缺页失败**

Run: `node --test --test-name-pattern="public site" test/unit/release-audit.test.js`

Expected: FAIL，错误列出 `site/index.html` 与缺失的隐私、支持、权利页面。

- [ ] **Step 3: 写入保留全部权利声明**

`RIGHTS.md` 必须明确：Copyright © 2026 935039168；源码仅供查看；未获书面许可不得复制、修改、合并、发布、分发、再授权、销售或制作衍生品；浏览器商店分发不构成向第三方授予这些权利；第三方商标归各自权利人。

- [ ] **Step 4: 建立共享紫色视觉与双语页面**

`site/styles.css` 使用 `#232338`、`#7c3aed`、`#a78bfa` 品牌色，响应式宽度不超过 960px，正文对比度达到可读水平。首页包含产品定位、核心功能、本地隐私、Chrome/Edge “即将上线 / Coming soon”状态、隐私/支持/权利导航。隐私和支持页面逐句对应中英文版本，支持链接固定为 `https://github.com/935039168/VeilRead/issues`。

- [ ] **Step 5: 运行测试和静态链接检查并提交**

Run: `node --test test/unit/release-audit.test.js`

Expected: PASS；站点内所有相对链接都能解析到 `site/` 下的实际文件。

```bash
git add RIGHTS.md site tools/release/audit.js test/unit/release-audit.test.js
git commit -m "docs: add bilingual privacy and support site"
```

### Task 3: 双语商店文案、权限理由与审核资料

**Files:**
- Create: `store/README.md`
- Create: `store/listing/chrome-zh-CN.md`
- Create: `store/listing/chrome-en.md`
- Create: `store/listing/edge-zh-CN.md`
- Create: `store/listing/edge-en.md`
- Create: `store/compliance/permissions-zh-CN.md`
- Create: `store/compliance/permissions-en.md`
- Create: `store/compliance/privacy-questionnaire-zh-CN.md`
- Create: `store/compliance/privacy-questionnaire-en.md`
- Create: `store/review/chrome-notes-zh-CN.md`
- Create: `store/review/chrome-notes-en.md`
- Create: `store/review/edge-notes-zh-CN.md`
- Create: `store/review/edge-notes-en.md`
- Create: `store/release-checklist.md`
- Modify: `test/unit/release-audit.test.js`
- Modify: `tools/release/audit.js`

- [ ] **Step 1: 增加会失败的资料一致性测试**

新增 `auditStoreDocuments(root)`：检查上述文件全部存在；中英文权限文件逐项包含 `permissionKeys`；所有文案都包含隐私与支持 URL；拒绝 `隐蔽`、`摸鱼`、`躲避监控`、`best`、`#1`、`officially certified`；审核说明必须覆盖自由悬浮窗、贴边面板、侧边栏、TXT、在线阅读、设置和紧急隐藏。

- [ ] **Step 2: 运行定向测试确认资料缺失**

Run: `node --test --test-name-pattern="store documents" test/unit/release-audit.test.js`

Expected: FAIL，按路径列出缺失文档。

- [ ] **Step 3: 完成商店 listing 文案**

四份 listing 使用同一事实：单一用途为“将用户选择的本地文本或网页内容以可定制阅读层呈现”；功能列出三种显示方式、TXT、网页正文提取、同站章节、样式与本地进度；英文明确 `The current in-extension interface is primarily Simplified Chinese.`；不承诺同步、多设备、云备份或跨站自动抓取。

- [ ] **Step 4: 完成合规与审核文件**

权限理由必须逐项说明用户可见功能和不使用权限会失去的能力。隐私问卷答案统一为：不出售、不用于广告、不用于信用/借贷、不传输给 VeilRead 服务器；网页内容仅设备端处理；用户触发的请求直接发往目标网站。审核说明提供从安装、打开普通 HTTPS 页面、触发各模式到验证紧急隐藏的编号步骤，并说明浏览器内部页面无法注入。

- [ ] **Step 5: 完成总索引与首发清单并提交**

`store/README.md` 链接每份文档、每组 PNG、公开站点 URL 和发布命令。`store/release-checklist.md` 分为账号准备、构建、Chrome 提交、Edge 提交、审核后五段，每项为可勾选条目；明确两家商店上传同一个 ZIP。

Run: `node --test test/unit/release-audit.test.js`

Expected: PASS。

```bash
git add store tools/release/audit.js test/unit/release-audit.test.js
git commit -m "docs: prepare bilingual store submissions"
```

### Task 4: 设置页隐私入口与可访问性

**Files:**
- Modify: `options/options.html:89-93`
- Modify: `options/options.css:81-146`
- Create: `test/unit/options-privacy.test.js`
- Modify: `docs/manual-acceptance.md`

- [ ] **Step 1: 写入会失败的设置页静态测试**

测试读取 `options/options.html`，断言存在文本为“查看隐私政策与权限说明”的 `<a>`，`href` 为中文隐私 URL，带 `target="_blank"` 和 `rel="noopener noreferrer"`，且原权限解释文字仍保留。

- [ ] **Step 2: 运行测试确认链接缺失**

Run: `node --test test/unit/options-privacy.test.js`

Expected: FAIL，提示未找到公开隐私政策链接。

- [ ] **Step 3: 增加链接和焦点样式**

在“权限与隐私”字段中加入公开链接；CSS 使用现有变量设置颜色，并为 `:focus-visible` 增加 2px 紫色轮廓和 2px 间距。不得新增额外权限，也不得通过脚本中转链接。

- [ ] **Step 4: 扩充手工验收并提交**

增加检查：链接在新标签打开正确 Pages 地址；键盘可聚焦；断网不影响扩展本地阅读功能。

Run: `npm test && npm run check`

Expected: 全部 PASS。

```bash
git add options/options.html options/options.css test/unit/options-privacy.test.js docs/manual-acceptance.md
git commit -m "feat: link privacy details from settings"
```

### Task 5: 完整发布审计命令

**Files:**
- Modify: `tools/release/config.js`
- Modify: `tools/release/audit.js`
- Create: `tools/release/check.js`
- Modify: `test/unit/release-audit.test.js`
- Modify: `package.json`

- [ ] **Step 1: 为图标、权限、远程代码和物料规格写失败测试**

测试临时复制最小仓库 fixture，再分别删除图标、写入 `eval(`、删除权限理由、伪造错误尺寸 PNG，断言审计错误包含具体相对路径和规则；同时断言真实仓库返回空错误数组。

- [ ] **Step 2: 运行测试确认未实现检查失败**

Run: `node --test test/unit/release-audit.test.js`

Expected: FAIL，缺少 `auditRepository` 或未发现注入的违规内容。

- [ ] **Step 3: 实现 PNG 与代码审计**

`readPngSize(buffer)` 校验 8 字节 PNG 签名并读取 IHDR 的宽高。代码扫描只覆盖发布白名单内的 `.js`、`.html`，拒绝 `eval(`、`new Function(`、远程 `<script src="http` 和静态/动态远程模块导入；普通 `fetch` 不判为远程代码。

- [ ] **Step 4: 实现仓库总审计入口**

`auditRepository(root)` 合并 Manifest/locales、图标 16/48/128、权限文档、公开页面、商店文档与代码扫描错误，并按路径排序；素材规格检查在 Task 6 将最终文件清单加入配置后启用。`check.js` 为每条具体错误添加 `ERROR ` 前缀，有错误时设置 `process.exitCode = 1`，成功输出 `Release check passed.`。

- [ ] **Step 5: 接入 npm 命令并提交**

将脚本设置为：

```json
{
  "test": "node --test test/unit/*.test.js",
  "check": "node --check lib/store.js && node --check lib/db.js && node --check lib/online.js && node --check content/extractor.js && node --check content/content.js && node --check reader/reader-core.js && node --check background/service-worker.js && node --check popup/popup.js && node --check sidebar/sidebar.js && node --check options/options.js && node --check tools/release/*.js",
  "release:check": "npm test && npm run check && node tools/release/check.js"
}
```

Run: `npm run release:check`

Expected: `Release check passed.`；素材检查会在 Task 6 与素材文件一起原子加入，避免主分支出现已知失败状态。

```bash
git add package.json tools/release test/unit/release-audit.test.js
git commit -m "build: add release compliance checks"
```

### Task 6: 可重复的真实界面商店素材

**Files:**
- Create: `test/store-assets.html`
- Create: `test/store-assets.css`
- Create: `test/store-assets.js`
- Create: `store/assets/source/promo.html`
- Create: `store/assets/source/promo.css`
- Create: `store/assets/source/brand.svg`
- Create: `tools/release/render-assets.js`
- Modify: `tools/release/config.js`
- Modify: `tools/release/audit.js`
- Create: `test/unit/store-assets.test.js`
- Create: `store/assets/generated/*`
- Modify: `package.json`

- [ ] **Step 1: 写入会失败的场景清单与尺寸测试**

测试要求 `render-assets.js` 导出 `ASSETS`，且清单恰好包含：`chrome-icon-128.png`、`edge-logo-300.png`；`promo-small-zh-CN.png`、`promo-small-en.png`；`promo-large-zh-CN.png`、`promo-large-en.png`；以及 `screenshot-01-float`、`02-edge`、`03-sidebar`、`04-settings`、`05-library` 的 `zh-CN` 与 `en` PNG。前两张尺寸分别为 `128x128`、`300x300`，宣传图分别为 `440x280`、`1400x560`，十张截图均为 `1280x800`；读取已生成 PNG 并逐个比较 IHDR 尺寸。

- [ ] **Step 2: 运行测试确认素材源和成品缺失**

Run: `node --test test/unit/store-assets.test.js`

Expected: FAIL，列出缺少的 16 个 PNG。

- [ ] **Step 3: 建立五个真实 UI 场景**

`test/store-assets.html?locale=zh-CN&scene=float|edge|sidebar|settings|library` 使用真实 `reader/reader-core.js`、`options/options.css`、`sidebar/sidebar.css` 与实际控件结构；fixture 文本固定且不包含真实用户数据。五个场景分别展示冷灰悬浮窗、贴边自动收起入口、长文侧边栏、设置页、TXT/在线书库。英文只替换外层说明，扩展 UI 保持当前中文并在素材说明中如实标注。

- [ ] **Step 4: 建立宣传图源文件**

`brand.svg` 复用当前 V 形图标路径和紫色配色；`promo.html` 根据 query 参数渲染中英文、小图/大图，文案分别为“专注阅读，不打断浏览 / Read without leaving the page”和“本地优先 · 三种阅读方式 / Local-first · Three reading modes”。不得写入未实现功能。

- [ ] **Step 5: 实现无头浏览器渲染器**

`render-assets.js` 优先读取 `VEILREAD_CHROME`，否则按 Windows Chrome、Edge 与 Linux/macOS 常见安装路径查找。脚本用 Node `http` 模块在 `127.0.0.1` 的系统分配端口提供仓库静态文件，依次使用 `--headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=W,H --screenshot=绝对路径 URL` 渲染，等待子进程成功后用 `readPngSize` 复核，最后可靠关闭服务器；找不到浏览器时明确打印可设置的环境变量并退出 1。

- [ ] **Step 6: 生成并人工查看全部素材**

在 `package.json` 增加 `"assets": "node tools/release/render-assets.js"`。

Run: `npm run assets && node --test test/unit/store-assets.test.js`

Expected: 输出 16 个文件，测试全部 PASS。逐张检查无裁切、无测试标识、无个人数据、冷灰和紫色视觉一致。

- [ ] **Step 7: 提交源文件与最终 PNG**

```bash
git add package.json test/store-assets.* store/assets tools/release/render-assets.js test/unit/store-assets.test.js
git commit -m "feat: add bilingual store artwork"
```

### Task 7: 确定性 ZIP 打包与包后复查

**Files:**
- Create: `tools/release/zip.js`
- Create: `tools/release/package.js`
- Create: `test/unit/release-package.test.js`
- Modify: `tools/release/config.js`
- Modify: `tools/release/audit.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 写入会失败的 ZIP 单元测试**

用临时目录创建 `manifest.json` 和嵌套文本/二进制文件，调用 `createZip(entries)` 后由 `listZipEntries(buffer)` 读取中央目录；断言路径为正斜杠、按字典序排列、内容 CRC 正确，且拒绝绝对路径和 `..`。

- [ ] **Step 2: 运行测试确认 ZIP 模块缺失**

Run: `node --test test/unit/release-package.test.js`

Expected: FAIL，找不到 `tools/release/zip.js`。

- [ ] **Step 3: 实现 ZIP writer/reader**

`zip.js` 使用 STORE 方法写 local header、central directory 和 EOCD；时间戳统一为 DOS epoch `1980-01-01 00:00:00`，保证相同输入得到相同 SHA-256。导出 `crc32`、`createZip`、`listZipEntries`，不引入 npm 依赖。

- [ ] **Step 4: 实现运行白名单与 package 命令**

白名单根项固定为 `manifest.json`、`_locales/`、`icons/`、`background/`、`content/`、`lib/`、`options/`、`popup/`、`reader/`、`sidebar/`。`package.js` 先调用 `auditRepository`，再生成 `dist/VeilRead-v1.0.0.zip`，随后重新读取目录，验证 Manifest 引用文件存在且没有 `.git`、`.claude`、`docs`、`site`、`store`、`test`、`tools`、`package.json`、README、`.map`。

- [ ] **Step 5: 接入命令、忽略生成包并验证确定性**

在 `package.json` 增加 `"package": "npm run release:check && node tools/release/package.js"`，在 `.gitignore` 增加 `dist/`。

Run: `npm run package`

Expected: 生成 `dist/VeilRead-v1.0.0.zip` 并打印文件数、字节数与 SHA-256。再次运行后 SHA-256 不变。

- [ ] **Step 6: 提交**

```bash
git add .gitignore package.json tools/release test/unit/release-package.test.js
git commit -m "build: create deterministic extension package"
```

### Task 8: README、发布手册与验收闭环

**Files:**
- Modify: `README.md`
- Create: `docs/releasing.md`
- Modify: `docs/manual-acceptance.md`
- Modify: `store/README.md`
- Modify: `test/unit/release-audit.test.js`

- [ ] **Step 1: 写入会失败的文档导航测试**

断言根 README 链接 `RIGHTS.md`、双语隐私/支持页、`store/README.md`、`docs/releasing.md`；发布手册包含 `npm run release:check`、`npm run assets`、`npm run package`、Chrome/Edge 开发者模式加载、两家商店人工提交、版本递增、Pages Source 设置。

- [ ] **Step 2: 运行测试确认导航缺失**

Run: `node --test --test-name-pattern="release documentation" test/unit/release-audit.test.js`

Expected: FAIL，列出缺少的链接或命令。

- [ ] **Step 3: 编写标准化首发流程**

`docs/releasing.md` 固定顺序：同步干净 `master`；更新版本与变更；运行测试和审计；生成/复核素材；生成 ZIP；Chrome 与 Edge 各侧载验收；部署并打开六个 Pages URL；同一个 ZIP 分别上传两家商店；粘贴对应双语资料；记录提交时间和商店版本；审核后替换主页安装链接。列出回滚方式为保留前一商店版本与前一 Git tag，不删除历史 tag。

- [ ] **Step 4: 更新 README 与人工验收**

README 增加“发布与合规”一节，说明本仓库源码可见但非开源、查看 `RIGHTS.md`，并提供所有文档入口。人工验收增加 Chrome/Edge 分别加载 ZIP 解压目录、双语 Manifest 展示、公开链接、所有素材尺寸和包内白名单检查。

- [ ] **Step 5: 运行测试并提交**

Run: `npm run release:check && npm run package`

Expected: 两条命令退出码均为 0。

```bash
git add README.md docs/releasing.md docs/manual-acceptance.md store/README.md test/unit/release-audit.test.js
git commit -m "docs: standardize first store release"
```

### Task 9: GitHub Actions 验证与 Pages 部署

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`
- Modify: `test/unit/release-audit.test.js`

- [ ] **Step 1: 写入会失败的工作流静态测试**

断言 CI 在 push 和 pull request 上运行 Node 20、`npm run release:check`、`npm run package`；Pages workflow 使用 `actions/configure-pages`、`actions/upload-pages-artifact`（path 为 `site`）和 `actions/deploy-pages`，权限仅包含 `contents: read`、`pages: write`、`id-token: write`，不包含商店密钥或上传步骤。

- [ ] **Step 2: 运行测试确认工作流缺失**

Run: `node --test --test-name-pattern="workflow" test/unit/release-audit.test.js`

Expected: FAIL，指出两个 workflow 不存在。

- [ ] **Step 3: 创建 CI 与 Pages workflow**

CI 使用 `actions/checkout@v4`、`actions/setup-node@v4` 和 Node 20；不运行 `npm install`，因为仓库无依赖。Pages 在 `master` push 和手动触发时部署 `site/`，设置 environment URL 为部署输出。

- [ ] **Step 4: 校验并提交**

Run: `npm run release:check && npm run package`

Expected: PASS；搜索 `.github/workflows` 不出现 `CHROME`、`EDGE`、`CLIENT_SECRET`、`API_KEY`。

```bash
git add .github/workflows test/unit/release-audit.test.js
git commit -m "ci: verify releases and deploy pages"
```

### Task 10: 最终发布候选验证

**Files:**
- Modify only if verification finds a defect: the smallest file responsible for that defect

- [ ] **Step 1: 运行全部自动验证**

Run: `npm test`

Expected: 所有单元测试 PASS。

Run: `npm run check`

Expected: 所有 JavaScript 语法检查通过。

Run: `npm run release:check`

Expected: `Release check passed.`。

Run: `npm run package`

Expected: `dist/VeilRead-v1.0.0.zip` 生成且包后复查通过。

- [ ] **Step 2: 检查 Git 与发布包边界**

Run: `git status --short`

Expected: 仅保留用户已有的 `.claude/` 未跟踪项；`dist/` 被忽略。

Run: `node -e "const fs=require('node:fs');const {listZipEntries}=require('./tools/release/zip.js');console.log(listZipEntries(fs.readFileSync('dist/VeilRead-v1.0.0.zip')).join('\n'))"`

Expected: 第一层仅出现 `_locales`、`background`、`content`、`icons`、`lib`、`options`、`popup`、`reader`、`sidebar` 和根 `manifest.json`。

- [ ] **Step 3: 在 Chrome 与 Edge 执行手工验收**

解压同一个 ZIP，分别在两款浏览器开发者模式加载；逐项执行 `docs/manual-acceptance.md`，重点复核全站碰边呼出、冷灰悬浮窗、贴边自动隐藏、侧边栏滚动、网站调整尺寸后隐藏小说不异常弹出、TXT、在线书和紧急隐藏。

- [ ] **Step 4: 检查公开页面与素材**

在 Pages 工作流部署后打开设计文档列出的六个 URL；检查中英文互链和 Issues 链接。逐一查看 16 张 PNG，确认尺寸、文字、真实 UI、无个人数据和紫色视觉。

- [ ] **Step 5: 建立首发 tag 前的最终提交**

若 Step 1-4 没有产生修复，不创建空提交；若有修复，先用 `git diff --name-only` 确认范围，逐一暂存输出中属于本轮修复的明确路径，重跑相关测试后提交为 `fix: finalize store release candidate`。不要暂存用户已有的 `.claude/`。

首发 tag 与推送仅在维护者确认两款浏览器手工验收结果后执行：

```bash
git tag -a v1.0.0 -m "VeilRead v1.0.0"
git push origin master
git push origin v1.0.0
```
