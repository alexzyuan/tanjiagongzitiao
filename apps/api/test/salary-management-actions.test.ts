import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("test_session_cookie_missing");
  return first.split(";")[0];
}

async function createDraft(
  app: ReturnType<typeof buildApp>["app"],
  cookie: string,
  rows = [{ userId: "employee-a", name: "员工A", 实发金额: 9000 }],
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/salary-batches",
    headers: { cookie },
    payload: {
      payrollMonth: "2026-08",
      title: "工资管理动作测试",
      rows,
    },
  });
  expect(response.statusCode).toBe(200);
  const batchId = response.json().batchId as string;
  const detail = await app.inject({
    method: "GET",
    url: `/v1/salary-batches/${batchId}`,
    headers: { cookie },
  });
  return { batchId, detail: detail.json() as { items: Array<{ id: string }> } };
}

describe("salary management actions", () => {
  it("deletes an untouched draft but rejects a partially delivered batch", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );

    const untouched = await createDraft(app, admin);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${untouched.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, batchId: untouched.batchId });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/salary-batches/${untouched.batchId}`,
          headers: { cookie: admin },
        })
      ).statusCode,
    ).toBe(404);

    const partial = await createDraft(app, admin, [
      { userId: "employee-a", name: "员工A", 实发金额: 9000 },
      { userId: "employee-b", name: "员工B", 实发金额: 8000 },
    ]);
    const sendOne = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${partial.batchId}/items/${partial.detail.items[0].id}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(sendOne.statusCode).toBe(200);
    const rejected = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${partial.batchId}`,
      headers: { cookie: admin },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe("salary_batch_not_deletable");
    await app.close();
  });

  it("edits only a withdrawn item and allows it to be sent again", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);
    const itemId = draft.detail.items[0].id;

    const beforeWithdraw = await app.inject({
      method: "PATCH",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}`,
      headers: { cookie: admin },
      payload: { fields: { 实发金额: 9100 } },
    });
    expect(beforeWithdraw.statusCode).toBe(409);
    expect(beforeWithdraw.json().code).toBe("salary_item_not_editable");

    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(withdrawn.statusCode).toBe(200);

    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}`,
      headers: { cookie: admin },
      payload: { fields: { 实发金额: 9100, 奖金: 300 } },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().items.find((item: { id: string }) => item.id === itemId).fields).toEqual({
      实发金额: 9100,
      奖金: 300,
    });
    expect(
      edited.json().items.find((item: { id: string }) => item.id === itemId)
        .deliveryStatus,
    ).toBe("withdrawn");

    const resent = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(resent.statusCode).toBe(200);
    expect(
      resent.json().batch.items.find((item: { id: string }) => item.id === itemId)
        .deliveryStatus,
    ).toBe("delivered");
    await app.close();
  });
});
