import { expect, test } from "@playwright/test";

test("admin can sign in and open salary management", async ({ page }) => {
  await page.goto("/?as=dev-admin");
  await expect(page.getByRole("heading", { name: "工资条管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传工资表" })).toBeVisible();
});

test("admin can create and send a salary batch", async ({ page }) => {
  await page.goto("/?as=dev-admin");
  await expect(page.getByRole("heading", { name: "工资条管理" })).toBeVisible();

  const batchId = await page.evaluate(async () => {
    const now = new Date();
    const payrollMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const draftResponse = await fetch("/v1/salary-batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payrollMonth,
        title: "E2E 工资批次",
        rows: [{ userId: "employee-e2e", name: "E2E 员工", 实发金额: 1 }],
      }),
    });
    const draft = (await draftResponse.json()) as { batchId: string };
    const sendResponse = await fetch(`/v1/salary-batches/${draft.batchId}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!sendResponse.ok) throw new Error(`salary_batch_send_failed:${sendResponse.status}`);
    return draft.batchId;
  });

  await page.reload();
  await expect(page.getByText("E2E 工资批次")).toBeVisible();
  expect(batchId).toMatch(/^batch-/);
});

test("employee can open a delivered salary slip", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?as=dev-admin");
  await expect(page.getByRole("heading", { name: "工资条管理" })).toBeVisible();

  const batchId = await page.evaluate(async () => {
    const now = new Date();
    const payrollMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const draftResponse = await fetch("/v1/salary-batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payrollMonth,
        title: "E2E 员工工资条",
        rows: [{ userId: "employee-e2e", name: "E2E 员工", 实发金额: 1 }],
      }),
    });
    const draft = (await draftResponse.json()) as { batchId: string };
    const sendResponse = await fetch(`/v1/salary-batches/${draft.batchId}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!sendResponse.ok) throw new Error(`salary_batch_send_failed:${sendResponse.status}`);
    return draft.batchId;
  });

  await page.goto(`/employee/salary-slips/${batchId}?as=employee-e2e`);
  await expect(page.getByText("E2E 员工工资条")).toBeVisible();
  await expect(page.getByText("实发金额")).toBeVisible();
});
