import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

describe("salary delivery", () => {
  it("sends a valid draft and records per-recipient delivery", async () => {
    const { app, store } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [{ userId: "employee-a", name: "员工A", 基本工资: 12000 }] } });
    const batchId = draft.json().batchId as string;
    const send = await app.inject({ method: "POST", url: `/v1/salary-batches/${batchId}/send`, headers: { cookie }, payload: {} });
    expect(send.json().batch.state).toBe("sent");
    expect(store.listDeliveries(batchId)).toHaveLength(1);
    await app.close();
  });

  it("holds a scheduled batch until the scheduled worker pass", async () => {
    const { app, salary } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-09", title: "2026年09月工资条", rows: [{ userId: "employee-a", name: "员工A", 实发金额: 1 }] } });
    const batchId = draft.json().batchId as string;
    const scheduled = await app.inject({ method: "POST", url: `/v1/salary-batches/${batchId}/send`, headers: { cookie }, payload: { scheduledAt: "2026-09-01T10:00:00.000Z" } });
    expect(scheduled.json().batch.state).toBe("scheduled");
    const beforeDue = await app.inject({ method: "POST", url: "/v1/admin/scheduled/run", headers: { cookie } });
    expect(beforeDue.json().processedBatchIds).toEqual([]);
    const afterDue = await salary.processScheduled({ kind: "main_admin", userId: "dev-admin" }, new Date("2026-09-01T10:01:00.000Z"));
    expect(afterDue.processedBatchIds).toEqual([batchId]);
    expect((await app.inject({ method: "GET", url: `/v1/salary-batches/${batchId}`, headers: { cookie } })).json().state).toBe("sent");
    await app.close();
  });
});
