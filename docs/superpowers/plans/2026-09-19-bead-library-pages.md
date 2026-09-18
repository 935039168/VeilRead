# Recovery Bead, Library, and Pages Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the floating recovery bead anchored to the browser's right and bottom edges, remove the unusable library open action, and publish the complete bilingual GitHub Pages site while retaining the store “Coming soon” state.

**Architecture:** Store recovery-bead geometry as `{ right, bottom }`, convert legacy `{ x, y }` values at the reader boundary, and derive CSS left/top coordinates from the current viewport without mutating the saved anchor during resize. Keep library management independent from content-script launching. Treat the checked-in `site/` tree as the only Pages artifact and make release audit enforce deployment and store-status contracts.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, Node.js built-in test runner, GitHub Actions, GitHub Pages.

---

### Task 1: Define and test right/bottom bead geometry

**Files:**
- Modify: `test/unit/reader-presentation.test.js`
- Modify: `reader/reader-core.js`

**Step 1: Write failing geometry tests**

Add assertions for exported reader utilities that cover the default bottom-right inset, an explicit `{ right, bottom }` anchor, clamping in a small viewport, conversion from legacy `{ x, y }`, and conversion of a dragged left/top point back to right/bottom distances. Include the concrete resize contract:

```js
const anchor = pointToBeadAnchor({ x: 900, y: 650 }, { width: 1200, height: 900 });
assert.deepEqual({ ...anchor }, { right: 260, bottom: 210 });
assert.deepEqual(
  { ...beadAnchorToPoint(anchor, { width: 1000, height: 700 }) },
  { x: 700, y: 450 },
);
```

Run `node --test test/unit/reader-presentation.test.js` and confirm the new export assertions fail.

**Step 2: Implement canonical anchor helpers**

In `reader/reader-core.js`, add pure helpers for normalizing an anchor, converting an anchor to a screen point, and converting a screen point to an anchor. Use a 40px bead and 8px safe inset. Preserve valid right/bottom values even when the current viewport forces a visual clamp, so expanding the browser restores the original dragged distances. Export the helpers through `readerUtils`.

**Step 3: Verify geometry tests**

Run `node --test test/unit/reader-presentation.test.js` and confirm all tests pass.

**Step 4: Commit**

Stage only the two task files and commit with `fix: anchor recovery bead to viewport edges`.

### Task 2: Integrate anchor persistence, dragging, and resize behavior

**Files:**
- Modify: `test/unit/reader-presentation.test.js`
- Modify: `reader/reader-core.js`
- Modify: `docs/manual-acceptance.md`

**Step 1: Add failing reader integration tests**

Extend the fake window harness so its viewport can change. Assert that a fresh floating reader places an unsaved bead at the lower-right inset, a stored right/bottom anchor produces the expected left/top coordinates, a legacy x/y record still renders at its old point, and applying settings again after changing viewport dimensions moves the visible bead while retaining its canonical anchor.

Run `node --test test/unit/reader-presentation.test.js` and confirm the new placement/resize cases fail.

**Step 2: Replace x/y state and persistence at integration points**

Update settings loading, `placeBead`, collapse placement, drag completion, panel move/resize reset, and visible-bead settings reapplication to use the canonical anchor. Pointer movement may continue to calculate left/top coordinates, but pointer release must persist `{ right, bottom }`. When settings are reapplied after `resize`, re-render the visible bead from the saved anchor even if its presentation state did not change.

**Step 3: Document manual resize acceptance**

Add a manual acceptance case that drags the bead, records its right/bottom gaps, resizes the browser smaller and larger, and verifies those gaps remain fixed whenever the viewport has sufficient room.

**Step 4: Verify and commit**

Run:

```powershell
node --test test/unit/reader-presentation.test.js test/unit/reader-regressions.test.js
npm run check
```

Stage only the three task files and commit with `fix: preserve dragged bead offsets on resize`.

### Task 3: Remove the settings-library open action

**Files:**
- Create: `test/unit/options-library.test.js`
- Modify: `options/options.js`
- Modify: `docs/manual-acceptance.md`
- Modify: `README.md`

**Step 1: Write a failing contract test**

Create a source-level UI contract test scoped to `renderBooks()` that asserts it does not create an `open` button, does not use the label `打开`, and does not dispatch `openWebBook`, while continuing to append rename, reset, and delete actions.

Run `node --test test/unit/options-library.test.js` and confirm it fails against the current implementation.

**Step 2: Remove only the unsupported action**

Delete the book-row open-button construction, active-tab lookup, opening message, and related alert handling from `renderBooks()`. Keep rename, progress reset, delete, import, and add-online-book behavior unchanged. Retain shared messaging helpers if another settings feature still uses them.

**Step 3: Align user documentation**

Update README and manual acceptance language so the settings page is described as book management, while opening/reading remains available through popup, page reader, and native side panel flows.

**Step 4: Verify and commit**

Run:

```powershell
node --test test/unit/options-library.test.js test/unit/content-reader-ui.test.js test/unit/service-worker.test.js
npm run check
```

Stage only the four task files and commit with `fix: keep settings library management-only`.

### Task 4: Make the bilingual static site deployable and auditable

**Files:**
- Modify: `test/unit/release-audit.test.js`
- Modify: `tools/release/audit.js`
- Modify: `.github/workflows/pages.yml`
- Verify: `site/index.html`
- Verify: `site/zh-CN/index.html`
- Verify: `site/en/index.html`
- Verify: `site/privacy/zh-CN/index.html`
- Verify: `site/privacy/en/index.html`
- Verify: `site/support/zh-CN/index.html`
- Verify: `site/support/en/index.html`
- Verify: `site/rights/index.html`

**Step 1: Write failing deployment and status tests**

Extend release-audit tests to require `enablement: true` beneath `actions/configure-pages@v5`, require both product pages to retain their localized Chrome and Edge coming-soon labels, and verify every required public page remains in the checked-in site tree.

Run `node --test test/unit/release-audit.test.js` and confirm the Pages enablement assertion fails.

**Step 2: Enforce the site contract in release audit**

Add localized store-status checks to `auditPublicSite`. Add `enablement: true` to the Pages configuration step, leaving the artifact path as `site` and retaining only `contents: read`, `pages: write`, and `id-token: write` permissions. Do not add store URLs or downloadable packages.

**Step 3: Verify the full release gate**

Run:

```powershell
npm run release:check
npm run package
```

Confirm the package excludes development-only files and the release audit accepts all bilingual pages.

**Step 4: Commit**

Stage only the workflow, audit implementation, and audit test. Commit with `ci: enable and audit GitHub Pages deployment`.

### Task 5: Review, push, deploy, and verify production URLs

**Files:**
- Review: all files changed by Tasks 1–4
- Verify remotely: GitHub Actions and `https://935039168.github.io/VeilRead/`

**Step 1: Inspect the final diff without touching unrelated files**

Run `git status --short`, `git diff origin/master...HEAD --check`, and review `git diff origin/master...HEAD`. Confirm the two existing modified screenshots plus `.claude/` and `books/` remain unstaged and absent from every new commit.

**Step 2: Run final verification**

Run `npm test`, `npm run check`, `npm run release:check`, and `npm run package`. Inspect the generated ZIP listing and confirm it contains extension runtime files only.

**Step 3: Perform code review and address findings**

Use the requesting-code-review skill against the final diff. Re-run focused tests and the full release gate after any correction, then commit each correction separately with a descriptive message.

**Step 4: Push the main branch**

Push `master` to `https://github.com/935039168/VeilRead.git` and confirm the remote head matches local HEAD.

**Step 5: Monitor GitHub Pages**

Wait for the `Deploy VeilRead Pages` workflow triggered by the push. If repository enablement still blocks deployment, inspect the failure and enable Pages through the GitHub API with `build_type=workflow`, then rerun the workflow.

**Step 6: Verify every public route**

Request the root, both language home pages, both privacy pages, both support pages, and the rights page. Require HTTP success, correct language content, working navigation, and unchanged “即将上线 / Coming soon” labels before reporting completion.
