import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

describe("SQLite API persistence", () => {
  it("keeps a created salary batch after the API restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "salary-api-sqlite-"));
    const databasePath = join(directory, "salary-slip.sqlite");
    try {
      const first = buildApp({ databasePath });
      const firstAuth = await first.app.inject({ method: "POST", url: "/v1/auth/dev" });
      const firstCookie = firstAuth.headers["set-cookie"]?.split(";")[0];
      await first.app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie: firstCookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [{ userId: "employee-1", name: "员工一", 基本工资: 12000 }] } });
      await first.app.close();

      const reopened = buildApp({ databasePath });
      const auth = await reopened.app.inject({ method: "POST", url: "/v1/auth/dev" });
      const cookie = auth.headers["set-cookie"]?.split(";")[0];
      const batches = await reopened.app.inject({ method: "GET", url: "/v1/salary-batches", headers: { cookie } });
      expect(batches.statusCode).toBe(200);
      expect(batches.json()).toMatchObject([{ payrollMonth: "2026-08", title: "2026年08月工资条" }]);
      await reopened.app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
