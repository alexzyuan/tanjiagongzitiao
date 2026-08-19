# 单人发送与双通知通道 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 排除工资表汇总行，支持按员工单人发送，并让工作通知与应用内 DING 按同一钉钉 UserID 独立投递和记录。

**Architecture:** 导入解析器在生成 RawRow 前过滤身份列中的汇总标签并返回忽略计数；SalaryService 将整批与单人投递统一到按 channel 执行的投递器。DingTalkClient 增加机器人 DING 方法，SQLite delivery 事件增加 channel/upstream ID/error code 字段，前端仅在已匹配项目上显示单人发送并展示双通道结果。

**Tech Stack:** TypeScript, Fastify, React, Vitest, SQLite/better-sqlite3, DingTalk legacy Open API.

---

### Task 1: 汇总行过滤与预览计数

**Files:**
- Modify: `apps/api/src/modules/salary/import.ts`
- Modify: `apps/api/src/modules/salary/service.ts`
- Modify: `apps/api/src/modules/salary/routes.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/api/test/salary-import.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add tests proving a row whose selected identity value is `合计` or starts with `汇总` is excluded, and that the preview result exposes `ignoredSummaryRows: 1` while retaining all real employee rows.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run `pnpm --filter @salary/api test -- salary-import.test.ts`; expect failure because the parser currently returns the summary row and `ImportPreviewResult` has no ignored count.

- [ ] **Step 3: Implement the minimal filtering behavior**

  Add `isSummaryLabel(value: unknown)` and filter identity values matching `合计|汇总|总计` after parsing. Change `previewRows` to return `{ preview, ignoredSummaryRows }`, propagate the count through the preview route, and render it in the import wizard without exposing salary values.

- [ ] **Step 4: Run focused and full API tests**

  Run `pnpm --filter @salary/api test -- salary-import.test.ts` and then `pnpm --filter @salary/api test`; expect all tests to pass and the real workbook parser to return only employee rows.

- [ ] **Step 5: Commit**

  Run `git add apps/api/src/modules/salary/import.ts apps/api/src/modules/salary/service.ts apps/api/src/modules/salary/routes.ts apps/api/test/salary-import.test.ts apps/web/src/App.tsx && git commit -m "fix: ignore payroll summary rows during import"`.

### Task 2: DING adapter and explicit configuration

**Files:**
- Modify: `packages/dingtalk/src/types.ts`
- Modify: `packages/dingtalk/src/client.ts`
- Modify: `packages/dingtalk/src/mock.ts`
- Modify: `packages/dingtalk/test/client.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing adapter tests**

  Add an HTTP fixture for the official robot DING endpoint using `userid_list`, assert the returned DING ID, and assert a missing robot code throws `dingtalk_ding_robot_code_missing` before any remote request.

- [ ] **Step 2: Run the focused package test and verify it fails**

  Run `pnpm --filter @salary/dingtalk test -- client.test.ts`; expect failure because the interface and implementation do not expose `sendDing`.

- [ ] **Step 3: Implement explicit DING configuration and method**

  Add `sendDing({ userId, content })`, add `DINGTALK_DING_ROBOT_CODE` as an optional production configuration value, pass it to `HttpDingTalkClient`, and call the robot DING API with `type: "APP"`/application reminder semantics and the matched `userId`. Preserve stable error codes for missing configuration, HTTP failure, and missing upstream ID. Add a deterministic mock implementation.

- [ ] **Step 4: Run package and API type checks**

  Run `pnpm --filter @salary/dingtalk test`, `pnpm --filter @salary/dingtalk typecheck`, and `pnpm --filter @salary/api typecheck`; expect all to pass.

- [ ] **Step 5: Commit**

  Run `git add packages/dingtalk apps/api/src/config.ts apps/api/src/server.ts && git commit -m "feat: add explicit DingTalk app DING channel"`.

### Task 3: Channel-aware delivery persistence and service behavior

**Files:**
- Modify: `packages/db/src/store.ts`
- Modify: `packages/db/src/sqlite-store.ts`
- Modify: `apps/api/src/modules/settings/routes.ts`
- Modify: `apps/api/src/modules/salary/service.ts`
- Modify: `apps/api/src/modules/salary/routes.ts`
- Test: `apps/api/test/salary-delivery.test.ts`
- Test: `packages/db/test/sqlite-store.test.ts`

- [ ] **Step 1: Write failing delivery tests**

  Add tests for `work_notice_with_ding`: one matched item calls both channels with the same UserID; a DING failure records only the DING failure and returns a partial failure; retry does not resend a previously successful work notification. Add a test that a non-manager cannot call the single-item route.

- [ ] **Step 2: Run focused tests and verify failure**

  Run `pnpm --filter @salary/api test -- salary-delivery.test.ts` and `pnpm --filter @salary/db test -- sqlite-store.test.ts`; expect failures for the missing channel field, route, and DING call.

- [ ] **Step 3: Extend SQLite delivery events with a migration**

  Add `channel` to `DeliveryRecord` with values `work_notice|ding`, add `upstreamId` and `errorCode`, update the table creation SQL, and add an idempotent `ALTER TABLE salary_deliveries ADD COLUMN channel TEXT NOT NULL DEFAULT 'work_notice'` migration for existing production databases. Add an index/lookup helper for the latest status by batch, employee, and channel.

- [ ] **Step 4: Implement channel-aware service delivery**

  Add `POST /v1/salary-batches/:batchId/items/:employeeUserId/send`. Refactor delivery into `deliverItem` and `deliverBatch`; execute only missing/failed channels, call work notification and DING separately based on settings, record each result, and return `sent|partially_failed` with channel results. Remove the current catch-and-continue behavior for DING/todo mode; an unavailable configured channel must be visible as failure and logged with request ID/correlation ID.

- [ ] **Step 5: Run all service/database tests**

  Run `pnpm --filter @salary/api test`, `pnpm --filter @salary/db test`, and `pnpm typecheck`; expect all to pass.

- [ ] **Step 6: Commit**

  Run `git add packages/db apps/api/src/modules/settings/routes.ts apps/api/src/modules/salary/service.ts apps/api/src/modules/salary/routes.ts apps/api/test/salary-delivery.test.ts packages/db/test/sqlite-store.test.ts && git commit -m "feat: deliver salary slips per employee and channel"`.

### Task 4: Single-send UI, settings, and release verification

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `README.md`

- [ ] **Step 1: Add the failing web API test**

  Add an API client test for the new item-send route and response shape containing per-channel statuses.

- [ ] **Step 2: Implement the UI action**

  Add a row-level “发送” action only for unsent/failed items, call the item endpoint, disable while busy, and render work-notice/DING channel results. Keep “全部发送” as the batch action and remove any checkbox path that appears to send selected items without an API call.

- [ ] **Step 3: Update settings and documentation**

  Replace the obsolete todo option with `work_notice_with_ding`, describe the required server `DINGTALK_DING_ROBOT_CODE`, and document that DING cannot be enabled until that value is configured.

- [ ] **Step 4: Run verification**

  Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`, and locally parse `/Users/maclex/Downloads/2026年7月工资表.xlsx` asserting no summary label remains.

- [ ] **Step 5: Deploy and verify production without sending payroll**

  Deploy the commit using the existing release procedure, check `/healthz`, check `systemctl is-active salary-slip`, and invoke only a synthetic single-send test with the mock adapter or a test database. Do not upload or send the real workbook until the user explicitly authorizes that external transmission and confirms the DING robot code is configured.

- [ ] **Step 6: Commit**

  Run `git add apps/web README.md && git commit -m "feat: expose single employee salary delivery"`.
