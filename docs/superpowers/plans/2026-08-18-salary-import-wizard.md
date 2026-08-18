# Salary Import Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make salary import a three-step, non-persistent-until-final-commit workflow and remove the salary-detail drawer from the management page's initial state.

**Architecture:** The import preview remains server-memory-bound to its creator and receives the parsed rows plus an explicit summary-row classification. The final commit carries validated per-batch display configuration, saved alongside encrypted payroll data. The React UI models the active batch and detail drawer independently, then renders a full-page three-step wizard.

**Tech Stack:** Fastify, Zod, TypeScript, Vitest, React 19, Vite, SQLite/better-sqlite3.

---

## File Structure

- Modify `packages/domain/src/salary.ts`: serializable per-batch salary-slip display settings.
- Modify `packages/db/src/store.ts`: store settings in the memory implementation.
- Modify `packages/db/src/sqlite-store.ts`: migration and storage for batch settings.
- Modify `packages/db/test/sqlite-store.test.ts`: settings persistence test.
- Modify `apps/api/src/modules/salary/import.ts`: source-row summary classification.
- Modify `apps/api/src/modules/salary/service.ts`: validate/save settings only at commit and audit counts.
- Modify `apps/api/src/modules/salary/routes.ts`: validate final commit payload.
- Modify `apps/api/test/salary-import.test.ts`: import and setting persistence tests.
- Modify `apps/web/src/api.ts`: preview and batch settings types.
- Modify `apps/web/src/App.tsx`: independent drawer state and wizard.
- Modify `apps/web/src/styles.css`: desktop wizard/preview layouts.
- Create `apps/web/src/App.test.tsx`: management and wizard state tests.

### Task 1: Define and Persist Batch Display Settings

**Files:**
- Modify: `packages/domain/src/salary.ts`
- Modify: `packages/db/src/store.ts`
- Modify: `packages/db/src/sqlite-store.ts`
- Test: `packages/db/test/sqlite-store.test.ts`

- [ ] **Step 1: Write the failing persistence test**

```ts
const displaySettings = {
  netAmountField: "实发工资", hideEmptyFields: true,
  feedbackEnabled: true, confirmationEnabled: false,
  notice: "工资条属于敏感信息，请注意保密",
  greeting: "{name}，工作辛苦啦", theme: "default" as const
};
const batch = first.createBatch({ ..., displaySettings });
first.close();
const reopened = new implementation.SqliteSalaryStore(databasePath, encryptionKey);
expect(reopened.getBatch(batch.id).displaySettings).toEqual(displaySettings);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @salary/db test -- sqlite-store.test.ts`

Expected: failure because `displaySettings` is absent from batch creation and retrieval.

- [ ] **Step 3: Define the domain contract and default**

```ts
export type SalarySlipTheme = "default" | "technology" | "night" | "gold" | "lotus";
export interface SalarySlipDisplaySettings {
  netAmountField: string;
  hideEmptyFields: boolean;
  feedbackEnabled: boolean;
  confirmationEnabled: boolean;
  notice: string;
  greeting: string;
  theme: SalarySlipTheme;
}
export const defaultSalarySlipDisplaySettings: SalarySlipDisplaySettings = {
  netAmountField: "实发金额", hideEmptyFields: true, feedbackEnabled: false,
  confirmationEnabled: false, notice: "工资条属于敏感信息，请注意保密",
  greeting: "{name}，工作辛苦啦", theme: "default"
};
```

Add `displaySettings` to batch summaries and the `createBatch` input. The memory store copies the given settings instead of holding a shared mutable default.

- [ ] **Step 4: Add the idempotent SQLite migration and mapping**

```ts
const columns = this.db.prepare("PRAGMA table_info(salary_batches)")
  .all() as Array<{ name: string }>;
if (!columns.some(column => column.name === "display_settings")) {
  this.db.exec("ALTER TABLE salary_batches ADD COLUMN display_settings TEXT NOT NULL DEFAULT '{}'");
}
```

Add `display_settings` to `BatchRow`, `INSERT INTO salary_batches`, and `toBatch`. Merge legacy `{}` values with the domain default. No payroll field values go into this column.

- [ ] **Step 5: Run the focused checks**

Run: `pnpm --filter @salary/db test -- sqlite-store.test.ts && pnpm --filter @salary/db typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/salary.ts packages/db/src/store.ts packages/db/src/sqlite-store.ts packages/db/test/sqlite-store.test.ts
git commit -m "feat: persist salary slip display settings"
```

### Task 2: Extend the Import Preview and Commit Contract

**Files:**
- Modify: `apps/api/src/modules/salary/import.ts`
- Modify: `apps/api/src/modules/salary/service.ts`
- Modify: `apps/api/src/modules/salary/routes.ts`
- Test: `apps/api/test/salary-import.test.ts`

- [ ] **Step 1: Write failing preview and commit tests**

```ts
const preview = previewRows([
  { 姓名: "员工A", 实发工资: 9000 },
  { 姓名: "合计", 实发工资: 9000 }
], directory, "name");
expect(preview.sourceRows.map(row => row.kind)).toEqual(["employee", "summary"]);
expect(preview.rows).toHaveLength(1);
```

Commit a valid preview with `displaySettings`; assert that `salary.getBatch(...).displaySettings.netAmountField` is `"实发工资"`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @salary/api test -- salary-import.test.ts`

Expected: failure because `sourceRows` and commit settings are absent.

- [ ] **Step 3: Preserve every source row while matching only employees**

```ts
export interface ImportSourceRow {
  row: number;
  source: RawRow;
  kind: "employee" | "summary";
}
const sourceRows = rows.map((source, index) => ({
  row: index + 2,
  source,
  kind: isSummaryLabel(String(source[strategyField(strategy)] ?? "")) ? "summary" : "employee"
}));
const rowsForMatching = sourceRows.filter(row => row.kind === "employee");
```

Return `sourceRows` and compute `ignoredSummaryRows` from them. Keep `rows` limited to matchable people so validation and commit cannot create a summary recipient.

- [ ] **Step 4: Validate configuration and audit only counts**

Use strict Zod validation: non-empty `netAmountField`, capped `notice` and `greeting`, booleans, and the five declared themes. Pass settings through `commitImport` to `createDraft` only after owner, expiry, unresolved-row, and directory validations pass.

```ts
{ previewId, parsedRows: preview.sourceRows.length,
  ignoredSummaryRows: preview.ignoredSummaryRows,
  matchedRows: preview.matched, manualResolutions: resolutions.length }
```

Use this count-only audit metadata; never log values, employee names, account numbers, or raw worksheet fields.

- [ ] **Step 5: Run checks**

Run: `pnpm --filter @salary/api test -- salary-import.test.ts && pnpm --filter @salary/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/salary/import.ts apps/api/src/modules/salary/service.ts apps/api/src/modules/salary/routes.ts apps/api/test/salary-import.test.ts
git commit -m "feat: retain import source preview until configured commit"
```

### Task 3: Replace the Modal with a Three-Step Import Wizard

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing state tests**

```tsx
it("does not render a salary detail drawer when management first loads", async () => {
  render(<App />);
  await screen.findByText("工资条管理");
  expect(screen.queryByText("工资表详情")).not.toBeInTheDocument();
});

it("does not commit while navigating from preview to settings", async () => {
  // Mock a preview containing one employee and one summary source row.
  // Upload, click “下一步”, and assert no /import/commit fetch call.
});
```

Mock only the session, batch, preview, directory and commit requests; do not use salary values in test messages.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @salary/web test -- App.test.tsx`

Expected: failure because `selected` automatically opens `BatchDetail` and the current import panel has two modal states.

- [ ] **Step 3: Split active batch from detail drawer state**

```tsx
const [activeBatchId, setActiveBatchId] = useState<string>();
const [detailBatchId, setDetailBatchId] = useState<string>();
const activeBatch = monthBatches.find(batch => batch.id === activeBatchId) ?? monthBatches[0];

useEffect(() => {
  setActiveBatchId(current =>
    monthBatches.some(batch => batch.id === current) ? current : monthBatches[0]?.id
  );
  setSelectedItems([]);
}, [month, monthBatches]);
```

Render `BatchDetail` only from `detailBatchId`. Set it only from explicit “查看发送” or row actions; never update it during load, refresh, or month changes.

- [ ] **Step 4: Implement the three wizard steps**

Render page-level `<section className="import-wizard">` and a labeled three-step progress header.

1. Upload posts only `/import/preview`, retaining month/title/file/strategy.
2. Preview displays horizontal source columns. `summary` rows show “汇总行，不导入”; unmatched employee rows retain existing manual directory selection. Its “下一步” only changes the step.
3. Settings derives selectable fields from the first employee source row; requires a net field and captures empty-field hiding, feedback, confirmation, notice, greeting, and theme. Show a non-sensitive visual preview with labels and masked/example values.

Errors stay within the current step. Closing simply unmounts the wizard and discards the memory preview.

- [ ] **Step 5: Make final completion the only commit path**

```ts
const result = await api<{ batchId: string }>("/v1/salary-batches/import/commit", {
  method: "POST",
  body: JSON.stringify({ previewId: preview.previewId, resolutions, displaySettings })
});
await onCreated(result.batchId);
```

The parent reloads batches, sets `activeBatchId` to the returned ID, closes the wizard, and leaves `detailBatchId` unset. Management amounts use `batch.displaySettings.netAmountField`, not a hard-coded fallback.

- [ ] **Step 6: Add desktop CSS**

Add `import-wizard`, `wizard-stepper`, `source-preview-scroll`, `import-settings-grid`, and `salary-slip-preview` styles. Fixed columns, long labels, focus states, and horizontal scrolling must remain stable. No mobile screenshot validation or remote image assets are in scope.

- [ ] **Step 7: Run frontend checks**

Run: `pnpm --filter @salary/web test -- App.test.tsx && pnpm --filter @salary/web typecheck && pnpm --filter @salary/web build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/App.test.tsx
git commit -m "feat: add three-step salary import wizard"
```

### Task 4: Verify and Document the Released Behavior

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-18-salary-import-wizard-design.md`

- [ ] **Step 1: Update living documentation**

Record that the preview is memory-only, summary rows are excluded from recipients, and display settings persist in SQLite. Do not say DING/single-recipient delivery is implemented.

- [ ] **Step 2: Run all repository checks**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 3: Manually verify desktop acceptance**

1. Open 工资条管理: no drawer or backdrop.
2. Upload an Excel workbook containing a summary row: source preview marks it “汇总行，不导入”.
3. Move to settings: no batch exists yet.
4. Complete settings: the management table displays the new active batch; no drawer opens.

- [ ] **Step 4: Commit documentation**

```bash
git add AGENTS.md docs/superpowers/specs/2026-08-18-salary-import-wizard-design.md
git commit -m "docs: record salary import wizard behavior"
```

## Self-Review

- Spec coverage: Tasks 1-3 implement the independent drawer, source preview, summary exclusion, manual matching, persistent settings, and post-commit management; Task 4 verifies and documents them.
- Placeholder scan: no unspecified validation or implementation steps remain.
- Type consistency: `SalarySlipDisplaySettings` is introduced in Task 1, passed as `displaySettings` in Task 2/3, and read as `batch.displaySettings` in Task 3.

