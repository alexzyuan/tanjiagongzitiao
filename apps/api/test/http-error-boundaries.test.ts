import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

function cookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("test_session_cookie_missing");
  return first.split(";")[0];
}

describe("salary HTTP error boundaries", () => {
  it("maps business conflicts to 409 while preserving employee withdrawal 404", async () => {
    const { app, store } = buildApp();
    const admin = cookie(await app.inject({ method: "POST", url: "/v1/auth/dev" }));

    async function createBatch() {
      const draft = await app.inject({
        method: "POST",
        url: "/v1/salary-batches",
        headers: { cookie: admin },
        payload: {
          payrollMonth: "2026-08",
          title: "HTTP 冲突测试",
          rows: [{ userId: "employee-a", name: "员工A", 实发金额: 9000 }],
        },
      });
      const batchId = draft.json().batchId as string;
      const detail = await app.inject({
        method: "GET",
        url: `/v1/salary-batches/${batchId}`,
        headers: { cookie: admin },
      });
      return { batchId, itemId: detail.json().items[0].id as string };
    }

    const itemConflict = await createBatch();
    store.setState(itemConflict.batchId, "sending");
    const itemNotSendable = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${itemConflict.batchId}/items/${itemConflict.itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(itemNotSendable.statusCode).toBe(409);
    expect(itemNotSendable.json().code).toBe("salary_item_not_sendable:sending");

    const batchConflict = await createBatch();
    store.setState(batchConflict.batchId, "sending");
    const batchNotSendable = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchConflict.batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(batchNotSendable.statusCode).toBe(409);
    expect(batchNotSendable.json().code).toBe("salary_batch_not_sendable:sending");

    const invalidTransition = await createBatch();
    store.setState(invalidTransition.batchId, "sending");
    const transition = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${invalidTransition.batchId}/withdraw`,
      headers: { cookie: admin },
    });
    expect(transition.statusCode).toBe(409);
    expect(transition.json().code).toBe(
      "invalid_salary_batch_transition:sending->withdrawn",
    );

    const sent = await createBatch();
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${sent.batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${sent.batchId}/items/${sent.itemId}/withdraw`,
      headers: { cookie: admin },
    });
    expect(withdrawn.statusCode).toBe(200);
    const employee = cookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );
    const withdrawnAccess = await app.inject({
      method: "GET",
      url: `/v1/me/salary-slips/${sent.batchId}`,
      headers: { cookie: employee },
    });
    expect(withdrawnAccess.statusCode).toBe(404);
    await app.close();
  });

  it("maps unknown notification failures to 500", async () => {
    const { app, dingtalk } = buildApp();
    const admin = cookie(await app.inject({ method: "POST", url: "/v1/auth/dev" }));
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "未知异常测试",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 9000 }],
      },
    });
    const batchId = draft.json().batchId as string;
    const detail = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    const itemId = detail.json().items[0].id as string;
    dingtalk.sendWorkNotification = async () => {
      throw new Error("unexpected_notification_failure");
    };

    const response = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("unexpected_notification_failure");
    await app.close();
  });

  it("maps DingTalk directory rate limits to a retryable 429", async () => {
    const { app, dingtalk } = buildApp();
    const admin = cookie(await app.inject({ method: "POST", url: "/v1/auth/dev" }));
    dingtalk.listDirectoryUsers = async () => {
      throw new Error(
        "dingtalk_api_error:directory.departments:errcode=90018,subcode=90018",
      );
    };

    const response = await app.inject({
      method: "GET",
      url: "/v1/directory/users?query=%E5%BE%90",
      headers: { cookie: admin },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: "dingtalk_rate_limited" });
    await app.close();
  });
});
