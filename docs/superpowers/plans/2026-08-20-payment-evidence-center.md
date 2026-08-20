# Payment Evidence Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将发薪存证从原始事件流水扩展为按员工分类、搜索、筛选详情并可导出 Excel 的主管理员/子管理员中心。

**Architecture:** 在 `apps/api/src/modules/reports` 增加专用 `EvidenceService`。员工列表只使用批次摘要、员工元数据和投递/存证事件；详情和导出在服务端根据 `Access` 过滤批次后才调用 `getBatch()` 解密工资字段。Web 端在现有 `EvidenceCenter` 内维护列表/详情状态，不引入路由或全局状态。

**Tech Stack:** Fastify 5, React 19, TypeScript, SQLite/WAL, Vitest, Vite, existing `xlsx` dependency, plain CSS.

**Spec:** `docs/superpowers/specs/2026-08-20-payment-evidence-center-design.md`

## Global Constraints

- 不实现 PDF、签名采集或温馨提示导出。
- 存证中心只允许主管理员和子管理员；子管理员只看现有 `access.batchIds` 中的未归档批次。
- 员工状态按当前钉钉通讯录是否包含 `userId` 实时判断，不写入 SQLite。
- 列表不得解密或返回工资字段；详情/导出只读取已筛选且已授权批次。
- 不引入新 runtime dependency、ORM、缓存、队列、Router、Redux 或 React Query。
- 保留原始 `GET /v1/payment-evidence` 事件接口；不修改发送、撤回、重发、确认、归档逻辑。
- 不记录工资金额、工资字段值、密钥、身份证或银行卡信息到日志/审计 metadata。
- 行为修改必须先增加失败测试；完成后运行目标测试、`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm architecture:check` 和 `git diff --check`。

---

### Task 1: Add non-decrypting employee metadata reads

**Files:**
- Modify: `packages/db/src/store.ts`
- Modify: `packages/db/src/sqlite-store.ts`
- Test: `packages/db/test/sqlite-store.test.ts`

**Interfaces:**
- Produces `StoredItemMetadata` with `id`, `batchId`, `employeeUserId`, `employeeName`, optional `employeeNo`, `department`, `position`, optional `viewedAt`, and optional `confirmedAt`.
- Produces `SalaryStore.listBatchItemMetadata(batchId: string): StoredItemMetadata[]`.
- The method must never return `fields` or invoke `decryptSalaryPayload`.

- [x] **Step 1: Write the failing store tests**

Extend `packages/db/test/sqlite-store.test.ts` to import both `MemorySalaryStore` and `SqliteSalaryStore`. The memory-store case creates a batch with a salary value and asserts `listBatchItemMetadata(batch.id)[0]` contains identity/timestamp metadata but no `fields` property. The SQLite-store case uses `:memory:` and makes the same assertion, verifying no salary value is present in the returned object.

- [x] **Step 2: Run the focused DB tests and verify failure**

Run: `pnpm --filter @salary/db test -- sqlite-store.test.ts`  
Expected: FAIL because `listBatchItemMetadata` is not defined on `SalaryStore` or its implementations.

- [x] **Step 3: Add the narrow interface and memory implementation**

In `packages/db/src/store.ts`, define `StoredItemMetadata` beside `StoredItem`, add the method to `SalaryStore`, and implement it by mapping encrypted batch items to metadata without calling `publicItem` or decrypting the payload. Return cloned metadata objects so callers cannot mutate store state.

- [x] **Step 4: Add the SQLite implementation**

In `packages/db/src/sqlite-store.ts`, select only `id`, `batch_id`, employee identity columns, `viewed_at`, and `confirmed_at` from `salary_items` for the given batch. Map rows to `StoredItemMetadata`; do not select ciphertext columns and do not call `toItem`.

- [x] **Step 5: Run the focused DB tests and verify success**

Run: `pnpm --filter @salary/db test -- sqlite-store.test.ts`  
Expected: PASS, including the existing SQLite persistence tests.

- [x] **Step 6: Commit the store boundary**

```bash
git add packages/db/src/store.ts packages/db/src/sqlite-store.ts packages/db/test/store.test.ts
git commit -m "feat: add non-decrypting salary item metadata query"
```

### Task 2: Build the EvidenceService and protected read endpoints

**Files:**
- Create: `apps/api/src/modules/reports/evidence.ts`
- Modify: `apps/api/src/modules/reports/routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/payment-evidence.test.ts`

**Interfaces:**
- `EvidenceService.listEmployees(access: Access, query?: { employmentStatus?: "active" | "departed"; query?: string }): Promise<EvidenceEmployeeSummary[]>`.
- `EvidenceService.getEmployeeDetail(access: Access, employeeUserId: string, filters: EvidenceFilters): Promise<EvidenceEmployeeDetail>`.
- `EvidenceService.exportXlsx(access: Access, input: EvidenceExportInput): Promise<Buffer>`.
- `EvidenceService` consumes `SalaryStore`, `DingTalkClient`, and `AuditService`; it does not call `listBatches()`.
- Reports routes receive the existing `dingtalk` client from `buildApp` so the service can resolve current directory membership.

- [x] **Step 1: Write failing service boundary tests**

In `apps/api/test/payment-evidence.test.ts`, create a `MemorySalaryStore` spy that throws from `listBatches()` and records `getBatch()` calls. Seed one authorized and one unauthorized batch with the same employee and assert `listEmployees` succeeds without `listBatches()`, while `getEmployeeDetail` only calls `getBatch()` for the authorized batch. Add a fake directory client with one active user and one absent user and assert the returned summaries classify them as `active` and `departed`.

- [x] **Step 2: Run the focused API test and verify failure**

Run: `pnpm --filter @salary/api test -- payment-evidence.test.ts`  
Expected: FAIL because `EvidenceService` and the new store-backed DTOs do not exist.

- [x] **Step 3: Implement access-scoped summary aggregation**

Implement a private `visibleBatchSummaries(access)` that accepts only `main_admin` and `sub_admin`; main admins receive all summaries, sub-admins receive non-archived summaries whose IDs are in `access.batchIds`. For the employee list, call `listBatchItemMetadata` for visible non-draft batches, call `listDeliveries(batchId)` and `listEvidence(batchId)` for status/count aggregation, then resolve `dingtalk.listDirectoryUsers()` once and classify every employee by user ID. Match `query` against name, employee number, and position before returning non-sensitive summaries.

- [x] **Step 4: Implement status and detail filtering**

Define exact status unions: `not_sent | sent | failed | withdrawn`, `not_viewed | viewed`, and `not_confirmed | confirmed`. Compute the latest delivery by `createdAt`; map delivery status to the send status; use metadata timestamps for view/confirm; set `confirmedBy` to the employee ID only when `confirmedAt` exists. Filter month range and statuses using metadata/events before calling `getBatch()` for surviving authorized batches. Return only non-draft rows and full salary fields for those rows.

- [x] **Step 5: Register the new GET routes**

Add Zod schemas in `apps/api/src/modules/reports/routes.ts` for employee-list and detail filters. Register `GET /v1/payment-evidence/employees` and `GET /v1/payment-evidence/employees/:employeeUserId`; keep the existing raw `GET /v1/payment-evidence` unchanged. Ensure employee identities receive the existing authorization error and sub-admins cannot inspect a batch outside `access.batchIds`.

- [x] **Step 6: Run API service and route tests**

Run: `pnpm --filter @salary/api test -- payment-evidence.test.ts`  
Expected: PASS for active/departed classification, search, month/status filters, sub-admin scope, no `listBatches()`, and no unauthorized `getBatch()` calls.

- [x] **Step 7: Commit the protected read endpoints**

```bash
git add apps/api/src/modules/reports/evidence.ts apps/api/src/modules/reports/routes.ts apps/api/src/server.ts apps/api/test/payment-evidence.test.ts
git commit -m "feat: add access-scoped payment evidence queries"
```

### Task 3: Add server-side Excel evidence export

**Files:**
- Modify: `apps/api/src/modules/reports/evidence.ts`
- Modify: `apps/api/src/modules/reports/routes.ts`
- Test: `apps/api/test/payment-evidence.test.ts`

**Interfaces:**
- `EvidenceExportInput` contains `employeeUserId`, optional month/status filters, and `fields: string[]`.
- `exportXlsx` returns a Node `Buffer` with one worksheet named `发薪存证`.
- The fixed columns are `员工姓名`, `工号`, `职位`, `工资月份`, `工资条标题`, `发送状态`, `查看状态`, `确认状态`, `确认时间`, `确认人`.

- [x] **Step 1: Add failing export assertions**

Extend `payment-evidence.test.ts` to POST an export request with one selected salary field, parse the returned buffer with the existing `xlsx` package, and assert fixed columns plus the selected field are present. Assert a field not present in the selected authorized rows is rejected with HTTP 400, and an unauthorized employee/batch cannot appear in the workbook.

- [x] **Step 2: Run the focused export test and verify failure**

Run: `pnpm --filter @salary/api test -- payment-evidence.test.ts`  
Expected: FAIL because the export route and workbook generation are not registered.

- [x] **Step 3: Implement workbook generation and audit metadata**

Use `XLSX.utils.json_to_sheet`, `XLSX.utils.book_new`, `XLSX.utils.book_append_sheet`, and `XLSX.write({ type: "buffer", bookType: "xlsx" })`. Reuse the same access-scoped filtered detail rows as the GET detail endpoint. Validate requested fields against the union of actual selected-row field names; record only `queryPresent`, `fieldCount`, and `rowCount` through `AuditService`.

- [x] **Step 4: Register the POST route**

Parse the JSON body with Zod, call `exportXlsx`, set `content-type` to `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and a safe attachment filename, and return the buffer. Do not return salary values in errors or logs.

- [x] **Step 5: Run focused API tests and verify success**

Run: `pnpm --filter @salary/api test -- payment-evidence.test.ts`  
Expected: PASS for workbook columns, selected-field validation, permissions, and audit metadata.

- [x] **Step 6: Commit the export endpoint**

```bash
git add apps/api/src/modules/reports/evidence.ts apps/api/src/modules/reports/routes.ts apps/api/test/payment-evidence.test.ts
git commit -m "feat: export payment evidence workbook"
```

### Task 4: Add Web API types and EvidenceCenter list/detail UI

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/EvidenceCenter.tsx`
- Modify: `apps/web/src/styles/admin.css`
- Test: `apps/web/src/pages/EvidenceCenter.test.tsx`

**Interfaces:**
- Add Web types matching the API DTOs: `PaymentEvidenceEmployee`, `PaymentEvidenceDetail`, `PaymentEvidenceRow`, `PaymentEvidenceFilters`, and the send/view/confirm status unions.
- `EvidenceCenter` keeps `{ refreshKey: number }` props and owns `selectedEmployee`, list filters, detail filters, and export modal state.

- [x] **Step 1: Write failing component tests**

Create a Vitest/Testing Library test with a mocked `api` returning two employee summaries (one active, one departed), then assert tabs, search result, employee metadata, detail status/confirmation time/person, status filter controls, and selected field checkboxes. Add an empty-list test and a download test that mocks `fetch`, `URL.createObjectURL`, and `URL.revokeObjectURL` and asserts the POST body contains the selected employee, filters, and fields.

- [x] **Step 2: Run the focused Web test and verify failure**

Run: `pnpm --filter @salary/web test -- EvidenceCenter.test.tsx`  
Expected: FAIL because the current page renders only raw event rows and has no list/detail state.

- [x] **Step 3: Add typed API contracts**

Add the status unions and response interfaces to `apps/web/src/api.ts`. Keep the existing generic `api<T>` helper unchanged; use native `fetch` only for the binary export response.

- [x] **Step 4: Implement the employee list view**

Load `/v1/payment-evidence/employees` with `employmentStatus` and `query`, render active/departed tabs, search input, table rows, counts, and the existing `EmptyState`/error patterns. Do not render salary fields in this view.

- [x] **Step 5: Implement employee detail and filters**

On row action, load `/v1/payment-evidence/employees/:employeeUserId` with URL-encoded month/status filters. Render back navigation, employee header, month range inputs, the three status groups, fixed status columns, confirmation time/person, and each returned salary field. Keep all state local to `EvidenceCenter`.

- [x] **Step 6: Implement Excel field modal and download**

Derive field options from the detail response, default all selected, keep fixed columns informational/non-toggleable, POST the JSON request to `/v1/payment-evidence/export.xlsx`, create a temporary object URL for the Blob, click a temporary anchor, and revoke the URL. Show `errorText` on non-2xx responses.

- [x] **Step 7: Add focused admin CSS only**

Add narrowly scoped `.evidence-*` selectors to `apps/web/src/styles/admin.css` for tabs, detail header, filter panel, field picker, table status cells, and download action. Preserve existing colors, spacing conventions, mobile breakpoints, and print rules; do not touch salary or employee styles.

- [x] **Step 8: Run the focused Web test and verify success**

Run: `pnpm --filter @salary/web test -- EvidenceCenter.test.tsx`  
Expected: PASS for list/detail/filter/export interactions and empty/error states.

- [x] **Step 9: Commit the Web feature**

```bash
git add apps/web/src/api.ts apps/web/src/pages/EvidenceCenter.tsx apps/web/src/pages/EvidenceCenter.test.tsx apps/web/src/styles/admin.css
git commit -m "feat: add payment evidence center UI"
```

### Task 5: Update App-level smoke coverage and compatibility assertions

**Files:**
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- App navigation continues to render `EvidenceCenter` through the existing module shell.
- The old raw-event route remains unchanged; App smoke tests mock `/v1/payment-evidence/employees` and detail responses.

- [x] **Step 1: Update failing smoke mocks**

Change the existing empty and non-empty evidence smoke tests to return employee-list responses and assert the visible active tab, employee identity, and detail action. Do not change the raw `GET /v1/payment-evidence` route.

- [x] **Step 2: Run the Web suite and verify the updated smoke tests**

Run: `pnpm --filter @salary/web test`  
Expected: PASS for existing salary/report/permission/settings tests plus the new evidence smoke coverage.

- [x] **Step 3: Commit compatibility coverage**

```bash
git add apps/web/src/App.test.tsx apps/api/test/http-error-boundaries.test.ts
git commit -m "test: cover payment evidence navigation and access"
```

### Task 6: Full verification and final review

**Files:**
- Modify: only files named in Tasks 1–5 if a verification command exposes a scoped defect.

- [x] **Step 1: Run package-focused tests**

Run:

```bash
pnpm --filter @salary/db test
pnpm --filter @salary/api test
pnpm --filter @salary/web test
```

Expected: all commands exit 0.

- [x] **Step 2: Run architecture and quality gates**

Run:

```bash
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit 0; architecture warnings may remain only where already allowed by project rules.

- [x] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- packages/db/src/store.ts packages/db/src/sqlite-store.ts apps/api/src/modules/reports apps/api/test/payment-evidence.test.ts apps/web/src/pages/EvidenceCenter.tsx apps/web/src/pages/EvidenceCenter.test.tsx apps/web/src/api.ts apps/web/src/styles/admin.css apps/web/src/App.test.tsx
```

Confirm that `.superpowers/`, `salary-slip-internal-app-20260818.zip`, SQLite files, unrelated refactors, and deployment changes are not staged or committed.

- [x] **Step 4: Review and commit any scoped verification fix**

Review the working tree after the gates. When a scoped fix was required, commit it with a message describing the observed regression; when no fix was required, leave the implementation commits unchanged. Do not push, merge, or deploy as part of this plan.
