# VeilRead

轻量级浏览器阅读插件（Chrome / Edge 及其它 Chromium 内核浏览器）。核心用途：在浏览普通网页的同时，以低干扰、低存在感的方式阅读小说或其它长文本——**随时出现、随时消失**，像藏在网页里的一层阅读层，而不是把一个完整的小说 App 搬进浏览器。

- 纯本地：无服务器、无登录、不上传任何内容
- 纯原生 JS：无依赖、无构建步骤、无打包器
- 轻量：不做后台轮询；为支持边缘呼出，普通网页会加载一个事件驱动的内容脚本，阅读器本体仅在需要时显示

---

## 1. 安装

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录
4. 快捷键可在 `chrome://extensions/shortcuts` 中查看与修改

要求 Chrome / Edge 116+（用到 `chrome.sidePanel.open`）。

> 权限说明：为在普通网页上提供边缘呼出、正文提取与同站章节翻页，扩展需要访问 HTTP/HTTPS 网页。VeilRead 没有自己的服务器，不上传书籍、阅读进度或浏览记录；在线阅读时仅向你当前阅读的**同一网站**请求章节和目录。

## 2. 功能需求与实现对照

### 2.1 本地 TXT 阅读

| 需求 | 实现 |
|---|---|
| 导入本地 TXT | popup 与设置中心均可导入；支持 UTF-8 / GBK / Big5 / UTF-16 / BOM 自动检测（`lib/txt.js` 严格解码逐级尝试） |
| 自动分章 | 识别「第X章 / 第X节 / 第X卷 / 楔子 / 序章 / 番外 / Chapter N」等标题行（阿拉伯数字与中文数字）；无章节标记时按段落边界分块（约 4.2 万字/块）；超长章节二次切分 |
| 阅读进度 | 「章节号 + 章内滚动比例」两级进度，滚动防抖 600ms 落盘，翻章 / 隐藏 / 切标签 / 关页时强制落盘；重开浏览器精确续读 |

### 2.2 在线网页 / 小说

| 需求 | 实现 |
|---|---|
| 正文提取 | Readability 简化算法（`content/extractor.js`）：段落打分选容器 + 兄弟节点扩充 + 白名单序列化；剔除广告、导航、评论、推荐、分享、页脚 |
| 章节标题 | 正文内/紧邻容器 h1-h3 > og:title > doc.title |
| 上一章 / 下一章 | 链接文字模式匹配（含「下一章 »」等变体）+ `rel=prev/next`；点击后仅同源抓取下一页并提取（15 秒超时、2 MB 上限，免刷新连读） |
| 章节目录 | 自动识别「目录 / 返回目录 / 章节列表」等链接；抓取目录页后按「最大链接组」启发式定位章节列表（去重、剔除导航噪声）；可搜索、点击直达；翻章后目录保持可用 |
| 站点自定义规则 | 按域名配置 CSS 选择器（正文/标题/上一章/下一章/移除/目录），规则未命中自动回退内置算法 |
| 在线书记入书库 | 以「目录页 URL」为身份（无目录则以章节页），LRU 保留最近 60 本；书库中标记 [在线]，点击从上次章节继续 |
| 手动添加与编辑 | 设置中心「书库管理」可配置书名、起始章节链接与目录/书籍链接；书名留空时自动使用网站域名，修改目录/书籍链接会作为新书处理并清除旧进度 |
| 跨站打开 | 当前页与目标章节同站时保持原页悬浮打开；不同站时保留当前页、新开目标章节页并在加载后自动打开阅读层。打开失败会显示 HTTP、超时或正文识别等具体原因 |

### 2.3 三种显示形态

| 形态 | 说明 |
|---|---|
| 贴边隐藏面板 | 平时不可见，从屏幕上/下/左/右任一侧滑出；拖动内侧边缘调宽度（上下贴边调高度） |
| 自由悬浮窗（默认） | 可拖拽（顶部把手）、四角缩放、大小无上限；位置尺寸自动记忆；可选边缘吸附与鼠标移出自动收起。收起后的恢复圆点可自由拖动并记住位置，点击即恢复；移动、缩放或重置窗口后，圆点重新跟随窗口（已吸附时在对应边缘，未吸附时在右下角） |
| 原生侧边栏 | `chrome.sidePanel`，常驻；通过 popup 或设置页的“打开侧边栏”按钮主动打开，借道当前标签页的内容脚本提取正文 |

### 2.4 快速呼出与隐藏（核心体验）

| 交互 | 行为 |
|---|---|
| `Alt+V` | 显示 / 隐藏阅读器 |
| `Alt+X` | **紧急隐藏**：瞬间清空一切痕迹（含收起的小圆点），且所有悬浮触发失效，直到快捷键 / 插件入口主动打开 |
| `Alt+↑ / ↓` | 上一章 / 下一章 |
| `Esc` | 阅读器显示时立即隐藏 |
| 鼠标碰屏幕边缘 | 停留可配置延时后自动滑出（方向、热区厚度、延时均可配） |
| 鼠标离开 | 贴边面板可选**完全隐藏**或**收起为小圆点**；自由悬浮窗收起为小圆点（点击恢复），已吸附时圆点贴在吸附边，未吸附时位于窗口右下角 |
| 边缘小把手 | 可选的常驻半透明竖条：悬浮打开、点击常开/收起 |
| `Ctrl+滚轮` | 悬停阅读器时快速调透明度 |
| 阅读器内按键 | 悬停时 `←/→` 翻章、`PgUp/PgDn/空格` 翻页 |

工具栏 popup 顶部可直接切换「自由悬浮窗」或「贴边面板」，选项会立即同步至设置中心和已打开的阅读器；原生侧边栏仍通过单独的「打开侧边栏」按钮进入。popup 同时展示显示/隐藏、紧急隐藏、上下章与阅读器内 `Esc` 隐藏；Alt 组合可在浏览器快捷键页面修改。

### 2.5 外观与设置

- **三种 UI 形态的样式互相独立**：配色方案（纯白/米黄/纸白/墨绿/暗夜/纯黑）、文字色、背景色、透明度（1%–100%）、毛玻璃开关，按形态分别保存；字体/字号/行距/段首缩进为共用。阅读器内 `Aa` 所作修改会实时同步至设置中心
- 透明度 < 98% 时可选毛玻璃（背景模糊）或纯透明
- 设置中心五个分区（显示方式 / 阅读外观 / 呼出与隐藏 / 站点规则 / 书库管理），每个配置项配非技术向说明；阅读外观带实时预览
- 设置界面本身支持**白天 / 夜间模式**（默认白天：白底黑字），popup 与侧边栏同步跟随
- 阅读器内 `Aa` 弹层：字号 / 行距 / 透明度滑杆 / 毛玻璃开关 / 配色点选 / 悬浮窗位置重置，全部即时生效并保存

## 3. 架构

```
manifest.json                 MV3；permissions: storage / unlimitedStorage /
                              sidePanel / contextMenus / scripting
                              host_permissions: http(s)://*/*（用于普通网页）
                              commands: toggle / emergency / 上下章
├── lib/                      纯函数库，按上下文加载
│   ├── store.js              设置与进度（chrome.storage.local）
│   ├── db.js                 书库（IndexedDB，仅扩展上下文）
│   └── txt.js                TXT 解码与分章（仅扩展上下文）
├── reader/reader-core.js     阅读器 UI 核心（零 chrome.* 依赖，
│                              由内容脚本与侧边栏共用，挂载即用）
├── content/
│   ├── extractor.js          正文/目录提取（纯 DOM，页面与抓取页通用）
│   └── content.js            页面侧宿主：Shadow DOM 挂载、悬浮触发、
│                              托盘、紧急隐藏、键盘、消息路由、同源抓取
├── background/service-worker.js  无状态事件分发：commands、右键菜单、
│                              书库数据、注入回退、侧边栏中转
├── popup/                    工具栏弹窗：续读、书库、导入、快捷动作
├── sidebar/                  原生侧边栏（同一 reader-core）
├── options/                  设置中心
└── test/                     开发用测试页与 chrome API 桩（不参与运行）
```

### 3.1 关键设计决策

**阅读层隔离**：内容脚本把宿主元素挂在 `document.documentElement` 下并使用 **closed Shadow DOM**。页面脚本不能通过 `element.shadowRoot` 直接访问内部 UI，样式在 Shadow 内注入、不会污染页面 CSS。closed Shadow DOM 不是安全边界，页面仍可能观察到宿主元素；它的作用是降低样式和 DOM 冲突。宿主永远 `pointer-events: none`，面板仅在显示时开启事件。

**数据分层**（按存储介质的能力与隔离性选择）：

| 数据 | 位置 | 原因 |
|---|---|---|
| 设置、TXT 进度、在线页进度 | `chrome.storage.local` | 内容脚本可直接读写；跨上下文 `onChanged` 实时同步 |
| 书籍全文与元数据 | IndexedDB（扩展源） | 大文本不受 storage 配额碎读影响；**内容脚本只能经 service worker 中转访问**，避免把书写进页面的源、被站点脚本读到 |

**进度模型**：TXT = `{chapter, ratio}`（章内滚动比例，字体无关且确定性还原）；在线书以目录/书页 URL 作为稳定身份，保存最后阅读章节；章节内滚动仍按完整章节 URL 存 `{title, ratio, bookUrl}`（上限 300 条）。手动配置书可自定义显示书名、起始章节与书籍身份链接。恢复时渲染后按比例回滚（`setTimeout` 而非 rAF——rAF 在后台标签页不触发）。

**消息协议**：`chrome.runtime.onMessage` 统一信封 `{type, ...}` → `{ok, data | error}`。内容脚本需要书数据时发 `book.getChapter` / `book.getToc` 给 SW；侧边栏需要页面内容时经 SW 中转到活动标签页（`sidebar.extract` / `sidebar.fetch` / `sidebar.fetchCatalog`）；popup/options 发 `tabSend` 由 SW 投递。打开跨站在线书时，SW 在新目标页完成加载后消费一次性 session 任务，再由该页内容脚本提取正文。所有发往标签页的路径带注入回退；内容脚本收到命令时会等待初始化完成，避免刚注入就丢快捷键。浏览器内部页、新标签页和扩展页仍受浏览器限制，无法注入。

**service worker**：事件驱动、空闲即休眠；每次被消息唤醒都从 storage/IDB 重建上下文。同时它是设置和进度写入的单一串行入口，避免多标签页读改写互相覆盖。

**紧急隐藏语义**：每标签页独立的 `emergency` 标志。置位后：边缘热区、托盘**悬浮**全部失效（托盘**点击**与快捷键、插件入口视为主动打开，会解除标志）。收起为小圆点期间，边缘触发同样失效（防止鼠标离开时扫过边缘导致面板弹出）。

**提取器安全**：输出 HTML 由白名单遍历**重建**（允许的标签 + 转义文本 + 补全的图片绝对 URL），不透传任何原始 HTML/属性/事件。

### 3.2 设置结构（`vr.settings`）

```js
{
  display: {
    mode: 'float' | 'edge' | 'sidebar',
    edge: 'left' | 'right' | 'top' | 'bottom',   // 贴边方向
    width: 440,                                    // 贴边厚度
    float: { x, y, w, h, snap, autoHide },         // 悬浮窗几何、边缘吸附、移出收起
    font, fontSize, lineHeight, maxWidth, indent,   // 共用排版
    styles: {                                       // 三形态独立外观
      float:   { color, bgColor, opacity, glass },
      edge:    { color, bgColor, opacity, glass },
      sidebar: { color, bgColor, opacity, glass },
    },
  },
  trigger: {
    hover, edge, thickness, vLimit, showDelay,
    autoHide,                 // 贴边隐藏面板：鼠标离开后自动收起
    autoHideMode: 'hide' | 'collapse',  // 完全隐藏 | 收起为小圆点
    autoHideDelay, tray, trayEdge, trayPos,
  },
  reading: { scrollStep },
  ui: { theme: 'day' | 'night' },   // 设置界面主题
  sites: [{ domain, content, title, prev, next, remove, catalog }],
}
```

读取时与默认值深度合并（数组整体替换）；旧版单一样式结构会在内存中迁移为三套独立样式，并在下一次正常保存设置时写回。

### 3.3 书库记录（IndexedDB `veilread`）

- `books`（元数据）：TXT `{id, title, size, addedAt, lastOpenAt, chapterCount, chapters:[{t,o,s}]}`；在线书 `{id:'w'+hash, type:'web', url, lastChapter, title, ...}`
- `texts`（全文）：`{id, text}`；章节正文 = `text.slice(chs[i].o, chs[i+1].s)`（`s`=跨度起点含标题行，`o`=正文起点）

### 3.4 章节切分规则

标题行 = 整行匹配且 ≤ 60 字：`第\s*[数字]\s*[章节回卷部集篇]…`、`楔子/序章/番外/后记…`、`Chapter N`、`卷 N`。首标题前的残文保留为「开头」；> 6 万字的章按段落边界二次切分并以 `(n)` 后缀编号。

## 4. 开发

```
node tools/gen-icons.js     # 重新生成图标
node tools/serve.js         # 本地静态服务器（默认 8642）
```

- `test/reader-test.html`：阅读器核心沙箱（无 chrome API，假宿主），覆盖进度恢复、目录、翻章、收起、四角缩放、四向贴边、透明度等
- `test/extract-test.html`：提取器样例页（仿小说站，含广告/评论/导航干扰）
- `test/popup-harness.html` / `test/options-harness.html`：注入 chrome API 桩后加载真实 popup/options 页面做集成测试

运行 `npm test` 执行单元测试；运行 `npm run check` 对扩展 JS 做语法校验。真实浏览器的加载、快捷键、侧边栏和权限验收步骤见 [手工验收清单](docs/manual-acceptance.md)。

## 5. 隐私

全部数据（书籍、进度、设置、站点规则）仅存储于浏览器本地（`chrome.storage.local` 与扩展源的 IndexedDB）。VeilRead 不建设服务器、不上传数据。唯一的外网流量是用户打开在线阅读后，对当前小说站同源章节和目录的请求；该请求带该站登录态以读取用户本来就能访问的内容，不会自动跟随跨站章节链接。
