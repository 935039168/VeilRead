# Online Book Launch and Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open configured online books reliably from any normal webpage and let users edit their identifying links and display name.

**Architecture:** Keep chapter fetching inside a same-origin content script. The service worker compares the current page and target chapter origins: it sends same-origin openings to the current page, or persists a one-shot task while opening a new target-page tab for cross-origin launches. Settings-page forms normalize online book metadata before updating IndexedDB and local progress metadata.

**Tech Stack:** Manifest V3, vanilla JavaScript, `chrome.tabs`, `chrome.storage.session`, IndexedDB, Node test runner.

---

### Task 1: Specify online-book URLs and launch decisions with pure tests

**Files:**
- Modify: `lib/online.js`
- Modify: `test/unit/online.test.js`

- [x] **Step 1: Add failing tests for normalized online-book metadata and cross-origin launch choice**

```js
test('normalizes an online book config and supplies a readable fallback title', () => {
  const cfg = online.normalizeWebBookConfig({
    title: '  ',
    chapterUrl: 'https://read.example.test/book/1/chapter/3',
    bookUrl: 'https://www.example.test/book/1/catalog',
  });
  assert.deepEqual(cfg, {
    title: 'www.example.test',
    chapterUrl: 'https://read.example.test/book/1/chapter/3',
    bookUrl: 'https://www.example.test/book/1/catalog',
  });
  assert.equal(online.shouldOpenOnlineInNewTab(cfg.chapterUrl, 'https://news.example.test/'), true);
  assert.equal(online.shouldOpenOnlineInNewTab(cfg.chapterUrl, 'https://read.example.test/home'), false);
});
```

- [x] **Step 2: Run the focused test and confirm it fails because the helpers do not exist**

Run: `node --test test/unit/online.test.js`

Expected: FAIL with `normalizeWebBookConfig is not a function`.

- [x] **Step 3: Add the minimal pure helpers**

```js
function normalizeHttpUrl(value, label) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (e) { throw new Error(`${label}无效`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label}仅支持 HTTP(S)`);
  return url.href;
}

function normalizeWebBookConfig(input) {
  const chapterUrl = normalizeHttpUrl(input && input.chapterUrl, '起始章节链接');
  const bookUrl = input && String(input.bookUrl || '').trim()
    ? normalizeHttpUrl(input.bookUrl, '目录/书籍链接')
    : chapterUrl;
  const title = String(input && input.title || '').trim() || new URL(bookUrl).hostname;
  return { title, chapterUrl, bookUrl };
}

function shouldOpenOnlineInNewTab(targetUrl, currentUrl) {
  try { return new URL(targetUrl).origin !== new URL(currentUrl).origin; }
  catch (e) { return true; }
}
```

Export all three through the current module return object.

- [x] **Step 4: Run the focused test and confirm it passes**

Run: `node --test test/unit/online.test.js`

Expected: PASS.

### Task 2: Make the service worker route cross-origin online books to their target page

**Files:**
- Modify: `background/service-worker.js`
- Modify: `content/content.js`
- Modify: `popup/popup.js`
- Modify: `options/options.js`

- [x] **Step 1: Persist and consume a one-shot launch instruction in `chrome.storage.session`**

Add a `PENDING_ONLINE_OPEN_PREFIX`, `pendingOnlineOpenKey(tabId)`, `queueOnlineOpen(tabId, data)`, and `takeOnlineOpen(tabId)`. Store `{ chapterUrl, bookUrl, title }`, remove the entry before sending the content-script message, and remove it on `chrome.tabs.onRemoved`.

- [x] **Step 2: Route `tabSend` online-book messages by origin**

In the `tabSend` handler, when `msg.msg.type === 'openWebBook'`, normalize `{ title: msg.msg.bookTitle, chapterUrl: msg.msg.url, bookUrl: msg.msg.bookUrl }`. If the target is same-origin, call `sendOrInject` unchanged. If it is cross-origin, create an active tab at the chapter URL, queue the task using the returned tab id, and return `{ ok: true, openedInNewTab: true }`.

- [x] **Step 3: Consume on page completion and parse the current target document**

Register `chrome.tabs.onUpdated`; on `status === 'complete'`, consume the task and call `sendOrInject(tab, { type: 'openWebBook', useCurrentPage: true, bookUrl, bookTitle, url: tab.url || chapterUrl })`. Update the content handler so `useCurrentPage` extracts `document` at `location.href`, while direct same-origin loads continue using `fetchAndExtract`. Use `bookTitle` ahead of the extracted title. On failure, render the reader empty state, show it, and toast the precise failure reason.

- [x] **Step 4: Preserve detailed errors in callers**

In popup and options, use `Error(res.error || '打开在线书失败')` for a returned content-script failure. Popup should show `打开在线书失败：${message}`; options should use the same message in its alert instead of claiming every failure is an internal-page restriction. Include `bookTitle: meta.title` in both messages.

- [x] **Step 5: Run syntax checks**

Run: `node --check background/service-worker.js; node --check content/content.js; node --check popup/popup.js; node --check options/options.js`

Expected: all commands exit 0.

### Task 3: Add and edit online books in the settings page

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.css`
- Modify: `options/options.js`
- Modify: `options/options.html` script list

- [x] **Step 1: Add the settings-page online-book form**

Before `#bookList`, add inputs `#webBookTitle`, `#webBookChapterUrl`, `#webBookUrl`, status `#webBookMsg`, and `#btnAddWebBook`. Explain that the chapter link is where reading starts, while the directory/book link identifies the book and can be different.

- [x] **Step 2: Save a new online book using the pure normalizer**

Load `../lib/online.js` before `options.js`. On add, call `online.normalizeWebBookConfig`, then `db.upsertWeb(config.bookUrl, config.chapterUrl, config.title)` and `store.saveWebBook(config.bookUrl, { lastChapter: config.chapterUrl, title: config.title })`. Clear only successful form fields, rerender the library, and surface validation errors through `#webBookMsg`.

- [x] **Step 3: Add an inline editor to every online-book row**

Replace the online-book rename action with an `编辑关键信息` button. Its expanded form contains the same three values and Save/Cancel buttons. Save with the same normalizer. If `bookUrl` changed, require a confirmation that the old book identity and progress will be cleared; only after successfully saving the new record, delete old IndexedDB metadata and call `store.clearWebBook(oldUrl, oldChapterUrl)`.

- [x] **Step 4: Add focused CSS and verify bindings**

Use the existing `.field`, `.grid`, `.ops`, and `.tip` visual language; add only `.web-book-form` / `.web-book-editor` spacing and responsive grid rules. Verify every `$('...')` reference in `options.js` has a matching HTML id.

### Task 4: Review, document, and verify

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-acceptance.md`
- Modify: `test/unit/online.test.js`

- [x] **Step 1: Perform a focused code review**

Review all changed data boundaries: URL validation, session task cleanup, navigation race behavior, error propagation, progress preservation, title precedence, and accessibility labels. Fix every actionable issue found before verification.

- [x] **Step 2: Document user-visible behavior and checks**

Document same-origin versus cross-origin launch behavior, editable online-book fields, and the fact that auto chapter fetching remains same-origin. Add manual checks for cross-origin launch, detailed same-origin error messages, form validation, changing identity, and same-origin next/previous chapters.

- [x] **Step 3: Run complete verification**

Run: `npm test; npm run check; Get-Content -Raw manifest.json | ConvertFrom-Json`

Expected: unit tests pass, every project JavaScript file parses, and manifest JSON loads.
