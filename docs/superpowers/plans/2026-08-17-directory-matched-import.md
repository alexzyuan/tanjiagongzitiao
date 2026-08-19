# Directory-Matched Salary Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a salary administrator upload an Excel workbook, match each row to a DingTalk organization member by UserID, employee number, or name, resolve exceptions, and create a sendable batch only after all recipients are uniquely identified.

**Architecture:** Extend the DingTalk adapter with an organization-directory read model and expose a server-side import-preview session. The browser submits the workbook for parsing, selects a matching strategy, reviews unmatched or ambiguous rows, records explicit overrides, then commits the resolved rows to the existing encrypted salary store.

**Tech Stack:** TypeScript, Fastify, Zod, XLSX, SQLite, React, Vitest.

---

### Task 1: Directory contracts and adapter

**Files:**
- Modify: `packages/dingtalk/src/types.ts`
- Modify: `packages/dingtalk/src/client.ts`
- Modify: `packages/dingtalk/src/mock.ts`
- Test: `packages/dingtalk/test/client.test.ts`

- [x] Write failing tests for listing active directory members and for preserving `userId`, name, employee number, department, and position.
- [x] Run `pnpm --filter @salary/dingtalk test` and confirm the new test fails because `listDirectoryUsers` is absent.
- [x] Add `DirectoryUser` and `listDirectoryUsers()` to the adapter. The HTTP adapter pages through organization departments and users using app credentials; the mock provides deterministic employees.
- [x] Re-run the package tests.

### Task 2: Deterministic row matching and preview service

**Files:**
- Modify: `apps/api/src/modules/salary/import.ts`
- Modify: `apps/api/src/modules/salary/service.ts`
- Test: `apps/api/test/salary-import.test.ts`

- [x] Write failing tests for UserID, employee-number, and name matching; assert duplicate names are `ambiguous`, absent names are `unmatched`, and invalid salary rows remain visible.
- [x] Run the focused test and confirm it fails due to missing preview logic.
- [x] Implement pure matching functions with exact matching only. Do not use fuzzy matching and never choose a person where a name maps to more than one enterprise user.
- [x] Re-run focused API tests.

### Task 3: Preview and commit API

**Files:**
- Modify: `apps/api/src/modules/salary/routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/salary-import.test.ts`

- [x] Write failing workflow tests for rejecting commit while exceptions remain and committing explicit override selections.
- [x] Run the focused tests and confirm expected failures.
- [x] Add admin-only preview, commit and preview-directory search endpoints. Store the preview in memory keyed to the current administrator, with a short TTL; log preview/commit counts but never salary values.
- [x] Re-run API tests.

### Task 4: Import wizard

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Add browser-facing types and API calls for preview/commit.
- [x] Replace the one-step Excel modal with strategy selection, match summary, row-level exception choices, and a disabled confirmation action until every row is uniquely matched.
- [x] Preserve existing manual entry and batch detail behavior.
- [x] Run typecheck/build and desktop browser checks for selecting each strategy. Ambiguous-row resolution is covered by API workflow tests; no mobile verification is required for this change.

### Task 5: End-to-end verification and deployment

**Files:**
- Modify: `README.md`
- Test: all workspace tests

- [ ] Document supported Excel fields: `姓名`, one salary field, optional `员工UserID`/`工号`; explain that UserID is recommended but no longer required.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- [ ] Deploy the committed release to the existing Aliyun service, then verify local and public health checks.
