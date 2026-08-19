# Salary Slip Internal Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DingTalk internal salary-slip application with scoped payroll management, payment evidence, reporting, permissions, system settings, employee self-service, and encrypted archival.

**Architecture:** A pnpm TypeScript monorepo contains a React/Vite internal web app, a Fastify API, a BullMQ worker, and shared domain/database packages. The API resolves a DingTalk auth code to a server-side session, applies batch-scoped authorization before every data operation, encrypts salary payloads, and emits append-only audit events. The worker owns scheduled sends, notification retries, and the active-to-archive transition.

**Tech Stack:** Node.js 22, pnpm workspaces, React, Vite, TanStack Router/Query, Fastify, Zod, SQLite via `better-sqlite3`, DingTalk JSAPI/OpenAPI, Vitest, React Testing Library, Playwright.

## SQLite Persistence Amendment

This implementation replaces the temporary in-memory salary store with an independent SQLite/WAL store. It retains the existing service and route contracts so DingTalk auth and the UI do not change. The API opens a single configured `SALARY_DATABASE_PATH`, enables foreign keys and WAL, records every state mutation transactionally, and has no in-memory fallback.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/server.ts` | Fastify bootstrap, request IDs, error serialization, route registration. |
| `apps/api/src/modules/auth/` | DingTalk auth-code exchange and signed server sessions. |
| `apps/api/src/modules/authorization/` | Main-admin, sub-admin, and batch-admin authorization policies. |
| `apps/api/src/modules/salary/` | Import, manual entry, validation, state changes, sending, and employee reads. |
| `apps/api/src/modules/evidence/` | Immutable payment-evidence queries. |
| `apps/api/src/modules/reports/` | Scoped summaries and streamed spreadsheet exports. |
| `apps/api/src/modules/settings/` | Notification, password, visibility, and retention settings. |
| `apps/api/src/modules/audit/` | Append-only audit event writer and reader. |
| `apps/worker/src/` | Scheduled-send, retry, and archive BullMQ processors. |
| `apps/web/src/pages/admin/` | Desktop pages for the five in-scope modules. |
| `apps/web/src/pages/employee/` | DingTalk mobile employee salary detail and history. |
| `packages/domain/src/` | Shared state-machine, authorization, and validation types. |
| `packages/db/prisma/schema.prisma` | PostgreSQL schema and encrypted-payload metadata. |
| `packages/db/src/` | Prisma client and salary encryption repository. |
| `packages/dingtalk/src/` | Typed DingTalk auth, work-notification, and todo adapters. |
| `tests/` | API integration, worker, UI, and end-to-end tests. |

## Task 1: Bootstrap the Monorepo and Local Services

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/api/package.json`, `apps/web/package.json`, `apps/worker/package.json`
- Create: `packages/domain/package.json`, `packages/db/package.json`, `packages/dingtalk/package.json`
- Create: `README.md`

- [ ] **Step 1: Write the workspace manifest and scripts.**

```json
{
  "name": "salary-slip-internal-app",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "dev": "pnpm --parallel --stream dev",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 2: Define the required local configuration without secrets.**

```dotenv
DATABASE_URL=postgresql://salary:salary@localhost:5432/salary_slip
REDIS_URL=redis://localhost:6379
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000
DINGTALK_CLIENT_ID=
DINGTALK_CLIENT_SECRET=
SALARY_ENCRYPTION_KEY=
SESSION_SIGNING_KEY=
```

- [ ] **Step 3: Add PostgreSQL and Redis development services.**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: salary_slip
      POSTGRES_USER: salary
      POSTGRES_PASSWORD: salary
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

- [ ] **Step 4: Start services and verify the empty workspace.**

Run: `docker compose up -d && pnpm install && pnpm lint && pnpm typecheck`

Expected: PostgreSQL and Redis are healthy; lint and type-check complete without errors.

- [ ] **Step 5: Commit.**

```bash
git add package.json pnpm-workspace.yaml docker-compose.yml .env.example README.md apps packages
git commit -m "chore: bootstrap salary slip workspace"
```

## Task 2: Define the Domain State Machine and Authorization Contracts

**Files:**
- Create: `packages/domain/src/salary.ts`
- Create: `packages/domain/src/authorization.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/salary.test.ts`
- Create: `packages/domain/test/authorization.test.ts`

- [ ] **Step 1: Write failing state-transition tests.**

```ts
import { canTransition } from "../src/salary";

it("allows an approved draft to be scheduled but not sent directly", () => {
  expect(canTransition("draft", "scheduled")).toBe(true);
  expect(canTransition("draft", "sent")).toBe(false);
});
```

- [ ] **Step 2: Write failing scope tests.**

```ts
import { canManageBatch } from "../src/authorization";

it("limits a sub-administrator to assigned payroll batches", () => {
  expect(canManageBatch({ kind: "sub_admin", batchIds: ["batch-a"] }, "batch-a")).toBe(true);
  expect(canManageBatch({ kind: "sub_admin", batchIds: ["batch-a"] }, "batch-b")).toBe(false);
});
```

- [ ] **Step 3: Implement the states and policies.**

```ts
export type SalaryBatchState = "draft" | "scheduled" | "sending" | "sent" | "partially_failed" | "withdrawn" | "archived";
const transitions: Record<SalaryBatchState, SalaryBatchState[]> = {
  draft: ["scheduled", "sending", "withdrawn"], scheduled: ["sending", "withdrawn"],
  sending: ["sent", "partially_failed"], sent: ["withdrawn", "archived"],
  partially_failed: ["sending", "withdrawn"], withdrawn: ["archived"], archived: []
};
export const canTransition = (from: SalaryBatchState, to: SalaryBatchState) => transitions[from].includes(to);
```

```ts
export type Access = { kind: "main_admin" } | { kind: "batch_admin" | "sub_admin"; batchIds: string[] } | { kind: "employee"; userId: string };
export const canManageBatch = (access: Access, batchId: string) => access.kind === "main_admin" || ("batchIds" in access && access.batchIds.includes(batchId));
```

- [ ] **Step 4: Run unit tests.**

Run: `pnpm --filter @salary/domain test`

Expected: all state and authorization tests pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/domain
git commit -m "feat: define salary state and authorization policies"
```

## Task 3: Model and Migrate the Encrypted Salary Database

**Files:**
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/crypto.ts`
- Create: `packages/db/src/salary-repository.ts`
- Create: `packages/db/test/crypto.test.ts`

- [ ] **Step 1: Write the failing encryption round-trip test.**

```ts
it("encrypts without retaining plaintext", () => {
  const encrypted = encryptSalaryPayload({ "basicSalary": 12000 });
  expect(JSON.stringify(encrypted)).not.toContain("12000");
  expect(decryptSalaryPayload(encrypted)).toEqual({ basicSalary: 12000 });
});
```

- [ ] **Step 2: Define the required Prisma records and unique constraints.**

```prisma
model SalaryBatch { id String @id @default(cuid()); payrollMonth DateTime; title String; state String; createdById String; scheduledAt DateTime?; items SalaryItem[]; admins SalaryBatchAdmin[]; @@index([payrollMonth]) }
model SalaryItem { id String @id @default(cuid()); batchId String; employeeUserId String; ciphertext Bytes; iv Bytes; authTag Bytes; batch SalaryBatch @relation(fields:[batchId], references:[id]); @@unique([batchId, employeeUserId]) }
model SalaryBatchAdmin { batchId String; userId String; batch SalaryBatch @relation(fields:[batchId], references:[id]); @@id([batchId, userId]) }
model AuditEvent { id String @id @default(cuid()); correlationId String; actorUserId String?; action String; targetType String; targetId String; outcome String; metadata Json; createdAt DateTime @default(now()) }
```

- [ ] **Step 3: Implement AES-256-GCM encryption with authenticated decryption.**

```ts
export function encryptSalaryPayload(payload: Record<string, unknown>) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}
```

- [ ] **Step 4: Apply the migration and rerun the test.**

Run: `pnpm --filter @salary/db prisma migrate dev --name initial_salary_models && pnpm --filter @salary/db test`

Expected: migration succeeds; encrypted payload test passes.

- [ ] **Step 5: Commit.**

```bash
git add packages/db
git commit -m "feat: add encrypted salary persistence"
```

## Task 4: Add DingTalk Identity and Directory Adapters

**Files:**
- Create: `packages/dingtalk/src/client.ts`
- Create: `packages/dingtalk/src/auth.ts`
- Create: `packages/dingtalk/src/notification.ts`
- Create: `apps/api/src/modules/auth/routes.ts`
- Create: `apps/api/test/auth.test.ts`

- [ ] **Step 1: Write a failing API test for auth-code exchange.**

```ts
it("creates a session from a DingTalk auth code", async () => {
  dingtalk.exchangeAuthCode.mockResolvedValue({ userId: "u-1", corpId: "corp-1" });
  const response = await app.inject({ method: "POST", url: "/v1/auth/dingtalk", payload: { authCode: "code" } });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ userId: "u-1" });
});
```

- [ ] **Step 2: Implement the adapter boundary and server-side session.**

```ts
export interface DingTalkClient { exchangeAuthCode(code: string): Promise<{ userId: string; corpId: string }>; sendWorkNotification(input: WorkNotification): Promise<{ taskId: string }>; createTodo(input: Todo): Promise<{ todoId: string }>; }
app.post("/v1/auth/dingtalk", async (request, reply) => {
  const identity = await dingtalk.exchangeAuthCode(request.body.authCode);
  return reply.code(201).send(await sessions.create(identity));
});
```

- [ ] **Step 3: Use the official DingTalk JSAPI `getAuthCode` only in the embedded client and exchange it only with the API.**

```ts
const authCode = await dd.requestAuthCode({ corpId, clientId });
await api.post("/v1/auth/dingtalk", { authCode: authCode.code });
```

- [ ] **Step 4: Run the API auth tests.**

Run: `pnpm --filter @salary/api test -- auth.test.ts`

Expected: auth-code exchange is tested with a fake adapter; no DingTalk secret appears in output.

- [ ] **Step 5: Commit.**

```bash
git add packages/dingtalk apps/api/src/modules/auth apps/api/test/auth.test.ts
git commit -m "feat: add DingTalk identity adapter"
```

## Task 5: Enforce Batch-Scoped Authorization and Auditing

**Files:**
- Create: `apps/api/src/modules/authorization/guard.ts`
- Create: `apps/api/src/modules/audit/service.ts`
- Create: `apps/api/test/authorization.test.ts`

- [ ] **Step 1: Write failing unauthorized-read and audit tests.**

```ts
it("returns 403 when a sub-administrator requests an unassigned batch", async () => {
  await seedSubAdmin({ userId: "u-2", batchIds: ["batch-a"] });
  const response = await requestAs("u-2").get("/v1/salary-batches/batch-b");
  expect(response.status).toBe(403);
  expect(await audit.has({ action: "salary_batch.read", outcome: "denied" })).toBe(true);
});
```

- [ ] **Step 2: Implement the reusable guard.**

```ts
export async function requireBatchAccess(request: AuthenticatedRequest, batchId: string) {
  const access = await accessService.forUser(request.session.userId);
  if (!canManageBatch(access, batchId)) throw app.httpErrors.forbidden("salary_batch_access_denied");
  return access;
}
```

- [ ] **Step 3: Implement append-only audit writes with salary-safe metadata.**

```ts
await audit.record({ correlationId: request.id, actorUserId: session.userId, action: "salary_batch.read", targetType: "salary_batch", targetId: batchId, outcome: "denied", metadata: { reason: "unassigned_batch" } });
```

- [ ] **Step 4: Run authorization tests.**

Run: `pnpm --filter @salary/api test -- authorization.test.ts`

Expected: unassigned reads and exports return 403 and create a denied audit event.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/authorization apps/api/src/modules/audit apps/api/test/authorization.test.ts
git commit -m "feat: enforce scoped salary authorization"
```

## Task 6: Implement Draft Creation, Excel Import, and Manual Entry

**Files:**
- Create: `apps/api/src/modules/salary/import.ts`
- Create: `apps/api/src/modules/salary/service.ts`
- Create: `apps/api/src/modules/salary/routes.ts`
- Create: `apps/api/test/salary-import.test.ts`
- Create: `apps/web/src/pages/admin/CreateSalaryBatchPage.tsx`

- [ ] **Step 1: Write failing import validation tests.**

```ts
it("returns row-level errors and does not create a sendable batch", async () => {
  const result = await importRows([{ employeeNo: "missing", basicSalary: "not-a-number" }]);
  expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, field: "basicSalary" })]));
  expect(result.batchState).toBe("draft");
});
```

- [ ] **Step 2: Implement strict parsing and error objects.**

```ts
export type ImportError = { row: number; field: string; code: "employee_not_found" | "duplicate_employee" | "invalid_number" | "missing_value"; message: string };
if (!Number.isFinite(Number(value))) errors.push({ row, field, code: "invalid_number", message: "Salary amount must be numeric" });
```

- [ ] **Step 3: Create draft and manual-entry endpoints behind `requireBatchAccess` or main-admin creation checks.**

```ts
app.post("/v1/salary-batches", { schema: { body: CreateBatchSchema } }, async (request) => salaryService.createDraft(request.session.userId, request.body));
app.post("/v1/salary-batches/:batchId/items", async (request) => salaryService.addManualItem(request.session.userId, request.params.batchId, request.body));
```

- [ ] **Step 4: Build the draft UI with upload, field mapping, row errors, and explicit preview confirmation.**

```tsx
{errors.map(error => <li key={`${error.row}-${error.field}`}>第 {error.row} 行 {error.field}: {error.message}</li>)}
<Button disabled={errors.length > 0} onClick={openPreview}>预览并确认</Button>
```

- [ ] **Step 5: Run API and UI tests.**

Run: `pnpm --filter @salary/api test -- salary-import.test.ts && pnpm --filter @salary/web test -- CreateSalaryBatchPage.test.tsx`

Expected: bad rows block confirmation; valid Excel and manual rows form a draft.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/salary apps/api/test/salary-import.test.ts apps/web/src/pages/admin/CreateSalaryBatchPage.tsx
git commit -m "feat: create salary drafts from imports and manual entry"
```

## Task 7: Send, Withdraw, Resend, and Schedule Salary Notifications

**Files:**
- Create: `apps/api/src/modules/salary/delivery-service.ts`
- Create: `apps/worker/src/salary-delivery.ts`
- Create: `apps/worker/src/queues.ts`
- Create: `apps/api/test/salary-delivery.test.ts`
- Create: `apps/worker/test/salary-delivery.test.ts`

- [ ] **Step 1: Write failing partial-send tests.**

```ts
it("marks only failed recipients as failed and the batch as partially_failed", async () => {
  dingtalk.sendWorkNotification.mockResolvedValueOnce({ taskId: "t-1" }).mockRejectedValueOnce(new Error("upstream timeout"));
  await delivery.sendBatch("batch-a");
  expect(await batch.state("batch-a")).toBe("partially_failed");
  expect(await deliveries.failedFor("batch-a")).toHaveLength(1);
});
```

- [ ] **Step 2: Implement idempotent per-recipient delivery jobs.**

```ts
await queue.add("salary-delivery", { batchId, employeeUserId }, { jobId: `salary:${batchId}:${employeeUserId}`, attempts: 3, backoff: { type: "exponential", delay: 1000 } });
```

- [ ] **Step 3: Send amount-free work notifications and optional confirmation todos.**

```ts
await dingtalk.sendWorkNotification({ userId, title: `${month}工资条`, body: "请在钉钉内查看工资明细", url: `${employeeUrl}?batch=${batchId}` });
if (settings.todoConfirmation) await dingtalk.createTodo({ userId, subject: `确认${month}工资条`, url: employeeUrl });
```

- [ ] **Step 4: Implement withdrawal and resend as new audited delivery events.**

```ts
await audit.record({ action: "salary_batch.resend", targetId: batchId, outcome: "accepted", metadata: { recipientCount } });
```

- [ ] **Step 5: Run worker and API tests.**

Run: `pnpm --filter @salary/api test -- salary-delivery.test.ts && pnpm --filter @salary/worker test -- salary-delivery.test.ts`

Expected: no failed recipient is reported as delivered; retries and audit events are visible.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/salary apps/worker apps/api/test/salary-delivery.test.ts
git commit -m "feat: deliver and track salary notifications"
```

## Task 8: Build the Employee Mobile Experience and 12-Month Archive Job

**Files:**
- Create: `apps/api/src/modules/salary/employee-routes.ts`
- Create: `apps/web/src/pages/employee/MySalarySlipsPage.tsx`
- Create: `apps/worker/src/archive-salary-slips.ts`
- Create: `apps/api/test/employee-salary.test.ts`
- Create: `apps/worker/test/archive-salary-slips.test.ts`

- [ ] **Step 1: Write failing identity-isolation and archive tests.**

```ts
it("never returns another employee's salary item", async () => {
  const response = await requestAs("employee-a").get("/v1/me/salary-slips/item-for-employee-b");
  expect(response.status).toBe(404);
});
```

```ts
it("archives active salary slips after twelve months", async () => {
  await archiveExpiredSalarySlips(new Date("2027-08-01"));
  expect(await batch.state("batch-from-2026-07")).toBe("archived");
});
```

- [ ] **Step 2: Implement employee routes without an employee ID path parameter.**

```ts
app.get("/v1/me/salary-slips/:batchId", async (request) => salaryService.readEmployeeItem(request.session.userId, request.params.batchId));
```

- [ ] **Step 3: Implement employee detail/history UI and view/confirmation events.**

```tsx
useEffect(() => { api.post(`/v1/me/salary-slips/${batchId}/view`); }, [batchId]);
return <SalaryDetail title={slip.title} fields={slip.fields} onConfirm={() => api.post(`/v1/me/salary-slips/${batchId}/confirm`)} />;
```

- [ ] **Step 4: Implement the worker archive transition and main-admin-only archive route.**

```ts
if (batch.payrollMonth < twelveMonthsAgo) await salaryRepository.archive(batch.id, { actor: "system", correlationId: job.id });
```

- [ ] **Step 5: Run identity and archive tests.**

Run: `pnpm --filter @salary/api test -- employee-salary.test.ts && pnpm --filter @salary/worker test -- archive-salary-slips.test.ts`

Expected: cross-employee reads return 404; only main administrators can read archives.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/salary apps/web/src/pages/employee apps/worker/src/archive-salary-slips.ts
git commit -m "feat: add employee salary access and encrypted archives"
```

## Task 9: Add Payment Evidence and Scoped Reports

**Files:**
- Create: `apps/api/src/modules/evidence/routes.ts`
- Create: `apps/api/src/modules/reports/service.ts`
- Create: `apps/api/src/modules/reports/routes.ts`
- Create: `apps/api/test/evidence.test.ts`
- Create: `apps/api/test/reports.test.ts`
- Create: `apps/web/src/pages/admin/EvidencePage.tsx`
- Create: `apps/web/src/pages/admin/ReportsPage.tsx`

- [ ] **Step 1: Write failing scope and evidence immutability tests.**

```ts
it("does not allow a scoped administrator to export unassigned payroll data", async () => {
  const response = await requestAs("scoped-admin").post("/v1/reports/export", { batchIds: ["unassigned-batch"] });
  expect(response.status).toBe(403);
});
```

```ts
it("creates a new evidence event on resend rather than mutating the original", async () => {
  await resend("batch-a");
  expect(await evidence.eventsFor("batch-a")).toHaveLength(2);
});
```

- [ ] **Step 2: Implement evidence filters and report aggregations.**

```ts
app.get("/v1/evidence", async (request) => evidenceService.list({ actor: request.session.userId, employment: request.query.employment, departmentId: request.query.departmentId, search: request.query.search }));
app.get("/v1/reports/summary", async (request) => reportService.summary(request.session.userId, request.query));
```

- [ ] **Step 3: Implement export as a streaming response and audit it.**

```ts
reply.header("content-type", "text/csv; charset=utf-8");
await audit.record({ action: "report.export", targetId: reportId, outcome: "completed", metadata: { filters, rowCount } });
return reply.send(csvStream);
```

- [ ] **Step 4: Build the evidence and report pages with filters, scope labels, detail drawers, and export controls.**

```tsx
<ScopeBadge scope={report.scope} />
<Button onClick={() => downloadReport(filters)}>导出表格</Button>
```

- [ ] **Step 5: Run module tests.**

Run: `pnpm --filter @salary/api test -- evidence.test.ts reports.test.ts && pnpm --filter @salary/web test -- EvidencePage.test.tsx ReportsPage.test.tsx`

Expected: evidence is append-only; reports and exports honor batch scope.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/evidence apps/api/src/modules/reports apps/web/src/pages/admin/EvidencePage.tsx apps/web/src/pages/admin/ReportsPage.tsx
git commit -m "feat: add payment evidence and scoped reports"
```

## Task 10: Implement Permission and System-Settings Administration

**Files:**
- Create: `apps/api/src/modules/permissions/routes.ts`
- Create: `apps/api/src/modules/settings/routes.ts`
- Create: `apps/api/test/permissions.test.ts`
- Create: `apps/api/test/settings.test.ts`
- Create: `apps/web/src/pages/admin/PermissionsPage.tsx`
- Create: `apps/web/src/pages/admin/SystemSettingsPage.tsx`

- [ ] **Step 1: Write failing permission assignment tests.**

```ts
it("lets only a main administrator assign a sub-administrator to a salary batch", async () => {
  expect((await requestAs("sub-admin").post("/v1/batches/batch-a/admins", { userId: "u-3" })).status).toBe(403);
  expect((await requestAs("main-admin").post("/v1/batches/batch-a/admins", { userId: "u-3" })).status).toBe(201);
});
```

- [ ] **Step 2: Implement settings validation.**

```ts
const SettingsSchema = z.object({ employeeVisibilityMonths: z.literal(12), passwordVerification: z.boolean(), notificationMode: z.enum(["work_notice", "work_notice_with_todo"]), todoConfirmation: z.boolean(), payrollReminder: z.boolean() });
```

- [ ] **Step 3: Implement main-admin-only routes and audit every mutation.**

```ts
app.put("/v1/settings", async (request) => settingsService.update(requireMainAdmin(request), SettingsSchema.parse(request.body)));
app.post("/v1/salary-batches/:batchId/admins", async (request) => permissionService.assignBatchAdmin(requireMainAdmin(request), request.params.batchId, request.body.userId));
```

- [ ] **Step 4: Build the tabs and settings controls matching the approved information architecture.**

```tsx
<Tabs items={["主管理员", "子管理员", "工资表管理员"]} />
<RadioGroup value={settings.notificationMode} options={[{ value: "work_notice_with_todo", label: "钉钉工作通知 + 待办事项" }, { value: "work_notice", label: "钉钉工作通知" }]} />
```

- [ ] **Step 5: Run permission and settings tests.**

Run: `pnpm --filter @salary/api test -- permissions.test.ts settings.test.ts && pnpm --filter @salary/web test -- PermissionsPage.test.tsx SystemSettingsPage.test.tsx`

Expected: settings reject any visibility value except 12; only main administrators change roles or settings.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/permissions apps/api/src/modules/settings apps/web/src/pages/admin/PermissionsPage.tsx apps/web/src/pages/admin/SystemSettingsPage.tsx
git commit -m "feat: add scoped permissions and payroll settings"
```

## Task 11: Assemble the Visual Shell and Operational Screens

**Files:**
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/components/AdminShell.tsx`
- Create: `apps/web/src/components/AuditLogDrawer.tsx`
- Create: `apps/web/src/pages/admin/SalaryManagementPage.tsx`
- Create: `apps/web/src/pages/admin/BatchDetailPage.tsx`
- Create: `apps/web/test/navigation.test.tsx`

- [ ] **Step 1: Write a failing navigation test.**

```tsx
it("renders the five approved management sections", async () => {
  render(<App />);
  for (const label of ["工资条管理", "发薪存证", "报表中心", "权限管理", "系统设置"]) expect(await screen.findByText(label)).toBeVisible();
});
```

- [ ] **Step 2: Build a responsive shell without copying DingTalk trademarks or source assets.**

```tsx
const navigation = ["工资条管理", "发薪存证", "报表中心", "权限管理", "系统设置"] as const;
return <AdminShell navigation={navigation} productName="薪资中心">{children}</AdminShell>;
```

- [ ] **Step 3: Add batch list/detail actions with stable state badges.**

```tsx
<StatusBadge state={batch.state} />
<Button aria-label="撤回工资条" disabled={!canWithdraw(batch.state)} onClick={() => withdrawBatch(batch.id)}>撤回</Button>
```

- [ ] **Step 4: Run component tests and desktop/mobile visual checks.**

Run: `pnpm --filter @salary/web test -- navigation.test.tsx && pnpm test:e2e -- --project=chromium`

Expected: the five pages are reachable, labels do not overflow, and destructive actions require a confirmation dialog.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src apps/web/test/navigation.test.tsx
git commit -m "feat: assemble salary management application shell"
```

## Task 12: End-to-End Security, Failure, and DingTalk Release Validation

**Files:**
- Create: `tests/e2e/salary-flow.spec.ts`
- Create: `tests/e2e/authorization.spec.ts`
- Create: `docs/operations/salary-slip-runbook.md`
- Modify: `README.md`

- [ ] **Step 1: Write the end-to-end payroll flow test.**

```ts
test("authorized payroll flow imports, previews, sends, and lets the employee confirm", async ({ page }) => {
  await loginAs(page, "main-admin");
  await createValidSalaryDraft(page, "2026-08");
  await page.getByRole("button", { name: "确认并发送" }).click();
  await loginAs(page, "employee-a");
  await page.goto("/employee/salary-slips/batch-2026-08");
  await expect(page.getByText("2026年08月工资条")).toBeVisible();
});
```

- [ ] **Step 2: Write cross-user, partial-delivery, archive, and audit assertions.**

```ts
test("employee cannot open another employee salary slip", async ({ request }) => {
  const response = await request.get("/v1/me/salary-slips/employee-b-item", { headers: employeeAToken });
  expect(response.status()).toBe(404);
});
```

- [ ] **Step 3: Document operational alerts and recovery.**

```markdown
Alert when a scheduled batch remains `sending` for over 15 minutes, any batch enters `partially_failed`, or an archive job fails. Recover by inspecting the correlation ID, fixing the concrete upstream cause, and explicitly requeueing only failed recipient jobs.
```

- [ ] **Step 4: Run the complete quality gate.**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`

Expected: all checks pass; tests demonstrate no unauthorized salary access and no silent partial-send success.

- [ ] **Step 5: Configure the DingTalk internal app only after the production base URL, callback URL, requested scopes, and version-approval choice have been reviewed by the user.**

Run: `dws devapp +webapp-config --help`

Expected: inspect exact current flags before creating or changing the production app configuration; do not publish credentials or select an approver automatically.

- [ ] **Step 6: Commit.**

```bash
git add tests docs/operations README.md
git commit -m "test: validate salary application security and operations"
```

## Plan Self-Review

**Spec coverage:** Salary management is covered by Tasks 6-8 and 11; payment evidence by Task 9; report center by Task 9; permissions and settings by Task 10; 12-month encrypted archive by Task 8; notification, audit, failure visibility, and operational behavior by Tasks 5, 7, and 12. The standalone annual-bonus, social-security, salary-calculation, gig-settlement, and human-cost-statistics modules are not planned. The report-center human-cost summary remains included because it is part of the approved report-center screen, not the excluded standalone human-cost-statistics module.

**Placeholder scan:** No placeholder tasks or deferred implementation language remain.

**Type consistency:** `SalaryBatchState`, `Access`, `canManageBatch`, `DingTalkClient`, and the batch/employee identifiers are defined before their use in later tasks.
