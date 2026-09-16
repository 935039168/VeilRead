# VeilRead 商店首发准备设计

## 目标

将 VeilRead 整理为可供可信测试用户侧载、并可提交 Chrome Web Store 与 Microsoft Edge Add-ons 的标准化首发项目。保留现有全站自动注入与碰边呼出能力，统一使用一份 Manifest V3 运行包，同时补齐可重复的打包校验、双语商店资料、真实产品素材、公开隐私与支持页面，以及面向维护者的发布文档。

## 已确认的产品与发布决策

- Chrome 和 Edge 共用同一套运行代码与同一个 ZIP 包，不维护商店专用分支。
- 保留 `http://*/*` 与 `https://*/*` 全站权限，因为任意网页上的碰边呼出、正文提取和同站章节阅读属于核心功能。
- 商店资料、隐私政策和支持页面同时提供简体中文与英文。
- 使用当前 GitHub 仓库的 GitHub Pages 承载产品介绍、隐私政策、支持和版权页面。
- 保留现有图标及紫色视觉风格，只补齐商店所需尺寸和宣传素材。
- 代码公开可见但不采用开源许可证；版权所有，未经书面许可不得复制、修改或再分发。
- 首版采用人工提交商店；不保存 Chrome 或 Edge 商店凭据，不自动上传商店。

## 仓库结构

现有运行目录保持不变：

- `background/`
- `content/`
- `icons/`
- `lib/`
- `options/`
- `popup/`
- `reader/`
- `sidebar/`
- `manifest.json`

新增以下边界清晰的发布内容：

- `tools/release/`：版本、Manifest、locale、权限说明、远程代码、物料完整性和 ZIP 内容校验；生成发布包。
- `store/`：Chrome 与 Edge 的中英文文案、权限理由、隐私问卷答案、审核测试说明、提交清单和素材源文件。
- `store/assets/`：商店 Logo、截图、宣传图及可编辑的 HTML/CSS/SVG 源文件。
- `site/`：GitHub Pages 的双语产品页、隐私政策、支持页、版权页和共享样式。
- `.github/workflows/`：持续验证和 GitHub Pages 部署，不包含商店上传流程。
- `dist/`：本地生成的发布 ZIP；加入 `.gitignore`，不提交生成物。
- `RIGHTS.md`：以仓库所有者 `935039168` 为版权主体的保留全部权利声明。

根 `README.md` 增加“发布与合规”导航；`store/README.md` 作为上架资料总索引。内部设计文档、测试、开发脚本、`.git` 与 `.claude` 不进入发布 ZIP。

## Manifest 与本地化

Manifest 保持版本 3。扩展名称和短简介改为 `__MSG_*__`，新增：

- `_locales/zh_CN/messages.json`
- `_locales/en/messages.json`
- `default_locale: "zh_CN"`

本地化范围首先覆盖 Manifest 中商店和浏览器会展示的名称与简介；现有功能界面不在本项目中整体英文化。英文商店文案将准确说明当前应用界面以中文为主，避免误导。

Manifest 简介使用透明、中性的阅读工具定位，不出现“隐蔽”“摸鱼”“躲避监控”等宣传措辞。`package.json` 与 `manifest.json` 的版本号必须一致；首发仍使用 `1.0.0`，以后每次上传必须递增版本。

## 权限与隐私

保留以下权限及其现有功能：

- `storage`：保存设置、阅读进度和在线书配置。
- `unlimitedStorage`：保存用户主动导入的较大 TXT 内容与章节索引。
- `sidePanel`：提供浏览器原生侧边栏阅读模式。
- `contextMenus`：提供现有右键菜单入口。
- `scripting`：在内容脚本缺失时按用户操作补充注入。
- `http://*/*`、`https://*/*`：在任意普通网页提供碰边呼出、正文提取及用户触发的同站章节/目录读取。

设置页增加可见的“隐私与权限”入口，链接到公开隐私政策，并用简洁文字说明页面内容、TXT、设置和阅读进度如何处理。

隐私政策必须同时说明：

- TXT 内容、书库元数据、设置、站点规则和阅读进度保存在浏览器本地。
- 网页正文只为用户可见的阅读功能在设备上解析和展示。
- 在线阅读请求由用户操作触发，直接发往用户选择的目标小说网站；VeilRead 不建设数据接收服务器。
- 当前版本不包含广告、遥测、第三方分析、数据出售或跨站跟踪。
- 卸载扩展将由浏览器清理扩展本地数据；用户也可通过书库和浏览器扩展管理界面清理数据。
- 支持与问题反馈使用 `https://github.com/935039168/VeilRead/issues`。

公开站点地址固定为：

- 产品主页：`https://935039168.github.io/VeilRead/`
- 中文隐私政策：`https://935039168.github.io/VeilRead/privacy/zh-CN/`
- English privacy policy：`https://935039168.github.io/VeilRead/privacy/en/`
- 中文支持：`https://935039168.github.io/VeilRead/support/zh-CN/`
- English support：`https://935039168.github.io/VeilRead/support/en/`
- 版权声明：`https://935039168.github.io/VeilRead/rights/`

## 打包与发布校验

新增命令：

```text
npm run release:check
npm run package
```

`release:check` 依次验证：

1. 运行全部单元测试和 JavaScript 语法检查。
2. Manifest 可解析、为 Manifest V3、版本合法且与 `package.json` 一致。
3. 中英文 locale 存在，Manifest 引用的消息键完整。
4. 16、48、128 图标存在且像素尺寸正确。
5. 每项 Manifest 权限在中英文权限说明中都有对应理由。
6. 运行代码中不存在 `eval`、`new Function`、远程 `<script>` 或远程模块导入。
7. 隐私政策、支持页面、商店文案、审核说明和提交清单齐全。
8. 商店 PNG 的尺寸、格式和数量符合目标商店规范。

`package` 在 `release:check` 通过后执行。打包器读取 Manifest 版本，只从运行文件白名单收集文件；首版生成 `dist/VeilRead-v1.0.0.zip`，后续文件名随 Manifest 版本自动变化。ZIP 根目录直接包含 `manifest.json`，不得带项目外层目录。

生成后必须重新读取 ZIP 并验证：

- 所有 Manifest 引用文件均存在。
- 包内仅包含运行白名单和 `_locales`。
- 不包含 `.git`、`.claude`、`docs`、`site`、`store`、`test`、`tools`、`package.json`、README 或源映射。
- Chrome 与 Edge 使用同一个校验通过的 ZIP。

错误必须给出具体文件或规则，并以非零状态退出；不得生成看似成功但内容不完整的包。

## 商店文案与审核资料

`store/` 提供简体中文和英文版本的：

- 名称、短简介和完整描述。
- 主要功能列表和准确的搜索词建议。
- 单一用途说明。
- 权限逐项理由。
- 数据使用与隐私问卷建议答案。
- Chrome 审核说明。
- Edge certification notes。
- 首次提交与后续更新清单。

文案定位为轻量、可定制、注重本地隐私的网页与小说阅读器。所有描述只宣传当前已经存在且通过验收的功能，不使用排名、最佳、官方认证等无法证明的表述。

## 商店素材

沿用现有图标和紫色品牌体系，生成：

- Chrome 商店图标：`128×128` PNG。
- Edge 商店 Logo：`300×300` PNG。
- 中英文小型宣传图：各一张 `440×280` PNG。
- 中英文大型宣传图：各一张 `1400×560` PNG。
- 中英文功能截图：各五张 `1280×800` PNG。

五组截图内容固定为：

1. 冷灰自由悬浮窗覆盖普通网页。
2. 贴边面板和自动收起入口。
3. 浏览器原生侧边栏长文阅读。
4. 配色、字体、透明度与显示方式设置。
5. 本地 TXT 和在线书库管理。

截图主体必须来自真实界面状态；允许在截图外层加入少量紫色标题和说明，但不能伪造功能。宣传图使用简洁紫色背景、现有图标和短定位，不使用大段文字。保留 HTML/CSS/SVG 源文件并通过自动渲染生成 PNG，以便后续更新。

Chrome 以五张 `1280×800` 截图为上限；Edge 复用相同截图。小型与大型宣传图分别使用两家商店共同支持的 `440×280` 与 `1400×560` 尺寸。Edge 使用推荐的 `300×300` Logo。

## GitHub Pages

`site/` 为无框架静态站点，避免引入构建依赖。包含：

- 双语产品首页。
- 双语隐私政策。
- 双语支持与常见问题。
- 版权声明。
- 共享紫色主题样式与现有图标。

页面根据浏览器语言选择首次入口，同时始终显示中英文切换链接。商店审核前，安装按钮显示“即将上线 / Coming soon”；审核通过后再更新为真实 Chrome 和 Edge 商店链接。

GitHub Actions 使用官方 Pages actions 发布 `site/`。仓库需要在 GitHub Pages 设置中选择 GitHub Actions 作为 Source。部署工作流不得访问发布凭据或修改运行包。

## 持续集成

Push 和 pull request 运行：

- `npm test`
- `npm run check`
- `npm run release:check`

Pages 工作流只负责部署静态站点。首次商店提交仍由维护者在 Chrome Developer Dashboard 和 Microsoft Partner Center 中人工上传同一个 ZIP、填写已准备的文案、上传物料并提交审核。

## 验收标准

- `npm test`、`npm run check` 和 `npm run release:check` 全部通过。
- `npm run package` 生成唯一的 `dist/VeilRead-v1.0.0.zip`，包内清单符合白名单且 Manifest 位于根目录。
- 生成 ZIP 能分别在 Chrome 与 Edge 的开发者模式中加载。
- popup、自由悬浮窗、贴边面板、原生侧边栏、TXT、在线阅读、设置页和紧急隐藏均通过现有手工验收。
- 全站权限行为未被削弱；碰边呼出仍能在普通 HTTP/HTTPS 页面工作。
- 双语 Manifest、商店文案、隐私问卷、审核说明和提交清单内容相互一致。
- GitHub Pages 的产品、隐私、支持和版权 URL 可公开访问，并可在中英文之间切换。
- 所有 PNG 尺寸正确、清晰、无伪造功能，中文与英文版本齐全。
- 根 README 和 `store/README.md` 能让新维护者从测试、打包一路操作到两家商店提交。
- 发布包中不存在开发文件、远程执行代码、商店凭据或用户数据。

## 非目标

- 不在本项目中把全部扩展 UI 英文化。
- 不缩减全站权限或改变碰边触发体验。
- 不接入广告、遥测或第三方分析。
- 不自动提交 Chrome Web Store 或 Edge Add-ons。
- 不创建 Chrome 与 Edge 的独立代码分支或独立运行包。
- 不引入前端框架、打包器或仅为发布使用的大型依赖。

## 官方规范依据

- Chrome Web Store 准备扩展包：<https://developer.chrome.com/docs/webstore/prepare>
- Chrome Web Store 商店素材：<https://developer.chrome.com/docs/webstore/best-listing>
- Chrome Web Store 政策：<https://developer.chrome.com/docs/webstore/program-policies/policies>
- Microsoft Edge 扩展发布：<https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension>
