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
});
