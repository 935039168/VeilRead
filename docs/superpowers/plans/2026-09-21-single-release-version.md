# Single Release Version Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `manifest.json` the only manually maintained release version and repair release-package tests so ZIP staging checks use the actual manifest version.

**Architecture:** Browser stores consume the Manifest, so `manifest.json.version` is the sole release source. Remove the redundant package version and its audit equality rule, then derive test ZIP paths from the fixture Manifest instead of a historic literal. Replace user-facing fixed ZIP examples with `<版本>` placeholders.

**Tech Stack:** Manifest V3 JSON, Node.js built-in test runner, Node.js release tools.

---

### Task 1: Test and implement the single version source

**Files:**
- Modify: `test/unit/release-package.test.js`
- Modify: `test/unit/release-audit.test.js`
- Modify: `tools/release/audit.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing regression tests**

Replace both literal `VeilRead-v1.0.0.zip` fixture paths in `test/unit/release-package.test.js` with a helper that reads `fixture/manifest.json` and returns `VeilRead-v${manifest.version}.zip`. Add an audit test that removes `package.json.version` from a copied release fixture and asserts `auditRepository(fixture)` has no version-related error.

- [ ] **Step 2: Run focused tests and verify the staging regression fails on the current version `1.0.1`**

Run: `node --test test/unit/release-package.test.js test/unit/release-audit.test.js`

Expected: the repaired staging test fails before package code is adjusted only if a stale literal remains; the package-version-optional audit test fails because the audit still reads and compares `package.json.version`.

- [ ] **Step 3: Make Manifest the sole manual version source**

Remove the root `version` fields from `package.json` and `package-lock.json`. In `tools/release/audit.js`, read only `manifest.json`, keep its `MAJOR.MINOR.PATCH` validation, and remove the package-version comparison. Preserve the user-provided `manifest.json` version `1.0.1`.

- [ ] **Step 4: Verify focused tests pass**

Run: `node --test test/unit/release-package.test.js test/unit/release-audit.test.js`

Expected: PASS; staging tests corrupt the real temporary ZIP path for any manifest version, while a package file with no version remains release-valid.

- [ ] **Step 5: Commit implementation**

Run: `git add manifest.json package.json package-lock.json tools/release/audit.js test/unit/release-package.test.js test/unit/release-audit.test.js; git commit -m "refactor: use manifest as release version source"`

### Task 2: Remove recurring version edits from documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/releasing.md`
- Modify: `docs/manual-acceptance.md`

- [ ] **Step 1: Replace fixed ZIP-version examples with placeholders**

Use `dist/VeilRead-v<版本>.zip` where instructions refer to the current release package. Change the release checklist to say only `manifest.json` is manually updated, while `package.json` intentionally has no release version.

- [ ] **Step 2: Run release verification**

Run: `npm run release:check && npm run package`

Expected: PASS; the generated ZIP filename contains `1.0.1` and no runtime/development file audit fails.

- [ ] **Step 3: Commit documentation**

Run: `git add README.md docs/releasing.md docs/manual-acceptance.md; git commit -m "docs: document manifest-only release versioning"`
