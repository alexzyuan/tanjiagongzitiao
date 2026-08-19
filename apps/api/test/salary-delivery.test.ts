import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import type { MockDingTalkClient } from "@salary/dingtalk";

describe("salary delivery", () => {
  it("rejects a concurrent single-employee send while the first is in flight", async () => {
    const { app, dingtalk } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-08",
        title: "并发发送测试",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 10000 }],
      },
    });
    const batch = (await app.inject({ method: "GET", url: `/v1/salary-batches/${draft.json().batchId}`, headers: { cookie } })).json();
    const itemId = batch.items[0].id as string;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    dingtalk.sendWorkNotification = async () => {
      calls += 1;
      await gate;
      return { taskId: "notice-concurrent" };
    };
    const first = app.inject({ method: "POST", url: `/v1/salary-batches/${batch.id}/items/${itemId}/send`, headers: { cookie }, payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await app.inject({ method: "POST", url: `/v1/salary-batches/${batch.id}/items/${itemId}/send`, headers: { cookie }, payload: {} });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("salary_item_send_in_progress");
    release();
    expect((await first).statusCode).toBe(200);
    expect(calls).toBe(1);
    await app.close();
  });

  it("sends a valid draft and records per-recipient delivery", async () => {
    const { app, store } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-08",
        title: "2026年08月工资条",
        rows: [{ userId: "employee-a", name: "员工A", 基本工资: 12000 }],
      },
    });
    const batchId = draft.json().batchId as string;
    const send = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie },
      payload: {},
    });
    expect(send.json().batch.state).toBe("sent");
    expect(store.listDeliveries(batchId)).toHaveLength(1);
    await app.close();
  });

  it("sends one selected employee through the same audited delivery path", async () => {
    const { app, store } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-08",
        title: "2026年08月工资条",
        rows: [
          { userId: "employee-a", name: "员工A", 实发金额: 10000 },
          { userId: "employee-b", name: "员工B", 实发金额: 9000 },
        ],
        displaySettings: {
          netAmountField: "实发金额",
          hideEmptyFields: true,
          confirmationEnabled: true,
          notice: "",
          greeting: "{name}",
          theme: "default",
          visibleFields: ["实发金额"],
          fieldGroups: [],
        },
      },
    });
    const batch = (
      await app.inject({
        method: "GET",
        url: `/v1/salary-batches/${draft.json().batchId}`,
        headers: { cookie },
      })
    ).json();
    const itemId = batch.items[0].id as string;
    const send = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batch.id}/items/${itemId}/send`,
      headers: { cookie },
      payload: {},
    });
    expect(send.statusCode).toBe(200);
    expect(store.listDeliveries(batch.id)).toHaveLength(1);
    expect(store.listDeliveries(batch.id)[0]?.employeeUserId).toBe(
      batch.items[0].employeeUserId,
    );
    const refreshed = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batch.id}`,
      headers: { cookie },
    });
    const refreshedItem = refreshed
      .json()
      .items.find((item: { id: string }) => item.id === itemId);
    expect(refreshedItem.deliveryStatus).toBe("delivered");
    const employeeCookie = (await app.inject({
      method: "POST",
      url: "/v1/auth/dev",
      payload: { userId: batch.items[0].employeeUserId, name: batch.items[0].employeeName },
    })).headers["set-cookie"]?.split(";")[0];
    await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batch.id}/view`,
      headers: { cookie: employeeCookie },
    });
    await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batch.id}/confirm`,
      headers: { cookie: employeeCookie },
    });
    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batch.id}/items/${itemId}/withdraw`,
      headers: { cookie },
      payload: {},
    });
    expect(withdraw.statusCode).toBe(200);
    expect(
      withdraw.json().items.find((item: { id: string }) => item.id === itemId)
        .deliveryStatus,
    ).toBe("withdrawn");
    const evidence = store.listEvidence(batch.id);
    expect(evidence).toHaveLength(4);
    expect(new Set(evidence.map((event) => event.fingerprint)).size).toBe(1);
    expect(JSON.stringify(evidence)).not.toContain("10000");
    expect(JSON.stringify(evidence)).not.toContain("员工A");
    await app.close();
  });

  it("lists enterprise directory users and only assigns an existing directory user as a sub-admin", async () => {
    const { app } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];

    const directory = await app.inject({
      method: "GET",
      url: "/v1/directory/users?query=%E5%91%98%E5%B7%A5A",
      headers: { cookie },
    });
    expect(directory.statusCode).toBe(200);
    expect(directory.json()).toMatchObject([
      { userId: "employee-a", name: "员工A" },
    ]);

    const assigned = await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie },
      payload: { userId: "employee-a" },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toEqual(["employee-a"]);

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie },
      payload: { userId: "not-in-directory" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe("directory_user_not_found");
    await app.close();
  });

  it("persists a reusable salary slip template", async () => {
    const { app } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const settings = {
      netAmountField: "实发工资",
      hideEmptyFields: true,
      confirmationEnabled: true,
      notice: "保密",
      greeting: "{name}，辛苦了",
      theme: "default",
      visibleFields: ["基本工资", "实发工资"],
      fieldGroups: [
        { id: "income", name: "应发工资", fieldKeys: ["基本工资"] },
      ],
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/salary-slip-templates",
      headers: { cookie },
      payload: { name: "常规工资条", settings },
    });
    expect(created.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/salary-slip-templates",
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject([{ name: "常规工资条", settings }]);
    await app.close();
  });

  it("holds a scheduled batch until the scheduled worker pass", async () => {
    const { app, salary } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-09",
        title: "2026年09月工资条",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 1 }],
      },
    });
    const batchId = draft.json().batchId as string;
    const scheduled = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie },
      payload: { scheduledAt: "2026-09-01T10:00:00.000Z" },
    });
    expect(scheduled.json().batch.state).toBe("scheduled");
    const beforeDue = await app.inject({
      method: "POST",
      url: "/v1/admin/scheduled/run",
      headers: { cookie },
    });
    expect(beforeDue.json().processedBatchIds).toEqual([]);
    const afterDue = await salary.processScheduled(
      { kind: "main_admin", userId: "dev-admin" },
      new Date("2026-09-01T10:01:00.000Z"),
    );
    expect(afterDue.processedBatchIds).toEqual([batchId]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/salary-batches/${batchId}`,
          headers: { cookie },
        })
      ).json().state,
    ).toBe("sent");
    await app.close();
  });

  it("resends only failed employees and remains idempotent", async () => {
    const { app, store, dingtalk } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const attempts: string[] = [];
    let employeeBFailures = 1;
    const mock = dingtalk as MockDingTalkClient;
    mock.sendWorkNotification = async (input) => {
      attempts.push(input.userId);
      if (input.userId === "employee-b" && employeeBFailures > 0) {
        employeeBFailures -= 1;
        throw new Error("simulated_delivery_failure");
      }
      return { taskId: `task-${input.userId}-${attempts.length}` };
    };
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-08",
        title: "重试幂等工资条",
        rows: [
          { userId: "employee-a", name: "员工A", 实发金额: 12000 },
          { userId: "employee-b", name: "员工B", 实发金额: 8000 },
        ],
      },
    });
    const batchId = draft.json().batchId as string;

    const firstSend = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie },
      payload: {},
    });
    expect(firstSend.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts)).toEqual(new Set(["employee-a", "employee-b"]));
    expect(firstSend.json().batch.state).toBe("partially_failed");

    const firstResend = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/resend`,
      headers: { cookie },
      payload: {},
    });
    expect(firstResend.statusCode).toBe(200);
    expect(attempts).toHaveLength(3);
    expect(attempts.at(-1)).toBe("employee-b");
    expect(firstResend.json().batch.sent).toBe(2);
    expect(firstResend.json().batch.total).toBe(2);
    expect(firstResend.json().batch.state).toBe("sent");

    const secondResend = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/resend`,
      headers: { cookie },
      payload: {},
    });
    expect(secondResend.statusCode).toBe(200);
    expect(attempts).toHaveLength(3);
    expect(secondResend.json().batch.sent).toBe(2);
    expect(secondResend.json().batch.total).toBe(2);
    expect(store.listDeliveries(batchId).filter((item) => item.status === "delivered")).toHaveLength(2);
    await app.close();
  });
});
