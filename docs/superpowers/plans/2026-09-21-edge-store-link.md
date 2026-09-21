# Edge Store Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the official Edge Add-ons link on both product home pages while Chrome remains marked as coming soon.

**Architecture:** Keep each store state as a structured `.status` element. Chrome remains a non-link `coming-soon` status; Edge becomes an external anchor with `data-browser="edge"`, `data-state="available"`, a fixed canonical URL, and localized visible text. The existing parse5-backed release audit validates each browser independently.

**Tech Stack:** Static HTML/CSS, Node.js `node:test`, parse5 release audit.

---

### Task 1: Make the release audit distinguish Edge availability from Chrome availability

**Files:**
- Modify: `test/unit/release-audit.test.js`
- Modify: `tools/release/audit.js`

- [ ] **Step 1: Write failing Edge-availability audit tests**

Add a constant in the test for the official URL and replace both product-status fixtures with:

```js
const edgeUrl = 'https://microsoftedge.microsoft.com/addons/detail/veilread/ocbckkfiomobcgocladilkofcbbjdjbj';
replaceProductStatuses(fixture, 'zh-CN',
  `<span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线</span><a class="status" data-browser="edge" data-state="available" href="${edgeUrl}" target="_blank" rel="noreferrer">Edge 已上线</a>`);
replaceProductStatuses(fixture, 'en',
  `<span class="status" data-browser="chrome" data-state="coming-soon">Chrome · Coming soon</span><a class="status" data-browser="edge" data-state="available" href="${edgeUrl}" target="_blank" rel="noreferrer">Edge · Available on Microsoft Edge Add-ons</a>`);
```

Assert the fixture passes. Then mutate the Edge URL, `data-state`, Edge text, and Chrome state independently and assert `auditPublicSite()` reports each error.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/unit/release-audit.test.js`

Expected: the new valid-availability fixture fails because the existing audit requires both browsers to be `coming-soon`.

- [ ] **Step 3: Implement structured per-store expectations**

In `tools/release/audit.js`, define the fixed `edgeStoreUrl`, a localized contract for both pages, and include `href`, `target`, and `rel` when collecting visible status elements:

```js
{ browser: 'edge', state: 'available', text: 'Edge 已上线', href: edgeStoreUrl,
  target: '_blank', rel: 'noreferrer' }
```

Require exactly one Chrome and one Edge status; validate each status against its own expected state/text. For available Edge, require the exact URL, `target="_blank"`, and a `rel` token of `noreferrer`. Do not permit a Chrome link or an Edge coming-soon state.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/unit/release-audit.test.js`

Expected: all release-audit tests pass, including malformed Edge-link cases.

- [ ] **Step 5: Commit the audit contract**

```powershell
git add test/unit/release-audit.test.js tools/release/audit.js
git commit -m "test: audit the published Edge store link"
```

### Task 2: Publish the Edge link and align release guidance

**Files:**
- Modify: `site/zh-CN/index.html`
- Modify: `site/en/index.html`
- Modify: `site/styles.css`
- Modify: `docs/releasing.md`

- [ ] **Step 1: Write failing real-page assertions**

Extend the product-home test with exact expected status markup assertions:

```js
assert.match(zh, /<a class="status" data-browser="edge" data-state="available" href="https:\/\/microsoftedge\.microsoft\.com\/addons\/detail\/veilread\/ocbckkfiomobcgocladilkofcbbjdjbj" target="_blank" rel="noreferrer">Edge 已上线<\/a>/);
assert.match(en, /Edge · Available on Microsoft Edge Add-ons/);
assert.match(zh, /<span class="status" data-browser="chrome" data-state="coming-soon">Chrome 即将上线<\/span>/);
```

Run `node --test test/unit/release-audit.test.js` and verify the new page assertions fail.

- [ ] **Step 2: Update both home pages and link styling**

Replace each Edge `span` with the specified external `a` element. Add this CSS so the linked badge keeps the existing visual design:

```css
a.status { text-decoration: none; }
a.status:hover { background: rgba(255,255,255,.14); }
```

Leave the Chrome status unchanged.

- [ ] **Step 3: Update publication guidance**

In `docs/releasing.md`, replace the instruction that waits for both stores with wording that Edge is already linked and only a future approved Chrome URL needs to replace Chrome’s coming-soon status.

- [ ] **Step 4: Verify the release gate**

Run:

```powershell
npm run release:check
npm run package
```

Expected: tests, syntax checks, public-site audit, and runtime-only ZIP verification pass.

- [ ] **Step 5: Commit and push**

```powershell
git add site/zh-CN/index.html site/en/index.html site/styles.css docs/releasing.md test/unit/release-audit.test.js
git commit -m "feat: publish the Edge Add-ons link"
git push origin master
```

### Task 3: Verify the deployed product pages

**Files:**
- Verify: `https://935039168.github.io/VeilRead/zh-CN/`
- Verify: `https://935039168.github.io/VeilRead/en/`

- [ ] **Step 1: Wait for the Pages deployment triggered by the push**

Use `gh run list --workflow pages.yml --branch master --limit 1` and require a successful run for the pushed commit.

- [ ] **Step 2: Verify public content**

Request both URLs and confirm each returns success, contains the unchanged Chrome coming-soon text, contains the official Edge URL, and contains the localized available text.

- [ ] **Step 3: Report the final store state**

State that Edge is linked to its live store page and Chrome remains coming soon.
