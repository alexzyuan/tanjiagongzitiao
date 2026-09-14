import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("test_session_cookie_missing");
  return first.split(";")[0];
}

describe("authorization boundaries", () => {
  it("gives an assigned sub-admin the same global salary-management permissions", async () => {
    const { app } = buildApp();
    const unauthorised = cookie(await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { userId: "hr-user" } }));
    const denied = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie: unauthorised }, payload: { payrollMonth: "2026-08", title: "工资条", rows: [{ userId: "employee-a", name: "员工A", 实发金额: 1 }] } });
    expect(denied.statusCode).toBe(403);

    const main = cookie(await app.inject({ method: "POST", url: "/v1/auth/dev" }));
    const subAdmins = await app.inject({ method: "POST", url: "/v1/sub-admins", headers: { cookie: main }, payload: { userId: "hr-user" } });
    expect(subAdmins.statusCode).toBe(200);
    expect(subAdmins.json()).toContain("hr-user");
    const created = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie: unauthorised }, payload: { payrollMonth: "2026-08", title: "子管理员创建的工资条", rows: [{ userId: "employee-a", name: "员工A", 实发金额: 1 }] } });
    expect(created.statusCode).toBe(200);
    const nowAuthorised = await app.inject({ method: "GET", url: "/v1/salary-batches", headers: { cookie: unauthorised } });
    expect(nowAuthorised.statusCode).toBe(200);
    expect(nowAuthorised.json()).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/v1/sub-admins", headers: { cookie: unauthorised } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/salary-slip-templates", headers: { cookie: unauthorised } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/directory/users", headers: { cookie: unauthorised } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/settings", headers: { cookie: unauthorised } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/payment-evidence", headers: { cookie: unauthorised } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/audits", headers: { cookie: unauthorised } })).statusCode).toBe(200);
    const mainBatches = await app.inject({ method: "GET", url: "/v1/salary-batches", headers: { cookie: main } });
    expect(mainBatches.statusCode).toBe(200);
    expect(mainBatches.json().every((batch: { items?: unknown }) => batch.items === undefined)).toBe(true);
    await app.close();
  });

  it("validates a sub-admin assignment with a direct directory user lookup", async () => {
    const { app, dingtalk } = buildApp();
    const main = cookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    let fullDirectoryReads = 0;
    const lookedUp: string[] = [];
    dingtalk.listDirectoryUsers = async () => {
      fullDirectoryReads += 1;
      throw new Error("full_directory_read_must_not_be_used_for_assignment");
    };
    dingtalk.getDirectoryUser = async (userId) => {
      lookedUp.push(userId);
      return userId === "hr-user"
        ? {
            userId,
            name: "人事管理员",
            employeeNo: "HR001",
            position: "人力资源",
            departmentIds: [2],
          }
        : undefined;
    };

    const assigned = await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie: main },
      payload: { userId: "hr-user" },
    });

    expect(assigned.statusCode).toBe(200);
    expect(lookedUp).toEqual(["hr-user"]);
    expect(fullDirectoryReads).toBe(0);
    await app.close();
  });

  it("allows sub-admins to read archived salary batches", async () => {
    const { app, store } = buildApp();
    const main = cookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: main },
      payload: {
        payrollMonth: "2026-08",
        title: "历史工资条",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 1 }],
      },
    });
    const batchId = draft.json().batchId as string;
    const sent = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: main },
      payload: {},
    });
    expect(sent.statusCode).toBe(200);
    expect(store.archiveExpired("2026-09")).toEqual([batchId]);

    const assigned = await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie: main },
      payload: { userId: "hr-user" },
    });
    expect(assigned.statusCode).toBe(200);
    const sub = cookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "hr-user", name: "人事管理员" },
      }),
    );

    const list = await app.inject({
      method: "GET",
      url: "/v1/salary-batches",
      headers: { cookie: sub },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({ id: batchId, state: "archived" }),
    ]);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: sub },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().state).toBe("archived");
    await app.close();
  });
});
