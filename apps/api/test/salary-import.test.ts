import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

async function cookieFor(app: ReturnType<typeof buildApp>["app"]) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/dev" });
  return response.headers["set-cookie"]?.split(";")[0];
}

describe("salary draft routes", () => {
  it("returns row-level errors and keeps invalid imports unsendable", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor(app);
    const response = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [{ name: "没有ID" }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchId).toBeUndefined();
    expect(response.json().errors[0].code).toBe("employee_not_found");
    await app.close();
  });

  it("creates a valid draft", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor(app);
    const response = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [{ userId: "employee-a", name: "员工A", 基本工资: 12000 }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchId).toMatch(/^batch-/);
    await app.close();
  });
});
