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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

  it("deletes a draft when every delivery attempt has failed", async () => {
    const { app, dingtalk } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);
    dingtalk.sendWorkNotification = async () => {
      throw new Error("notification_failed");
    };

    const failedSend = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${draft.detail.items[0].id}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(failedSend.statusCode).toBe(500);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, batchId: draft.batchId });
    await app.close();
  });

  it("does not delete a scheduled batch before its delivery window", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);

    const scheduled = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/send`,
      headers: { cookie: admin },
      payload: { scheduledAt: "2026-09-01T10:00:00.000Z" },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().batch.state).toBe("scheduled");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().code).toBe("salary_batch_not_deletable");
    await app.close();
  });

  it("deletes a partially failed batch when no employee was delivered", async () => {
    const { app, dingtalk } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);
    dingtalk.sendWorkNotification = async () => {
      throw new Error("notification_failed");
    };

    const failedSend = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(failedSend.statusCode).toBe(200);
    expect(failedSend.json().batch.state).toBe("partially_failed");
    expect(failedSend.json().batch.sent).toBe(0);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, batchId: draft.batchId });
    await app.close();
  });

  it("deletes a batch only after every salary item has been withdrawn", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin, [
      { userId: "employee-a", name: "员工A", 实发金额: 9000 },
      { userId: "employee-b", name: "员工B", 实发金额: 8000 },
    ]);
    const [first, second] = draft.detail.items;

    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${first!.id}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${second!.id}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${first!.id}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });

    const partiallyWithdrawn = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(partiallyWithdrawn.statusCode).toBe(409);
    expect(partiallyWithdrawn.json().code).toBe("salary_batch_not_deletable");

    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${second!.id}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });

    const summaries = await app.inject({
      method: "GET",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
    });
    expect(summaries.statusCode).toBe(200);
    expect(summaries.json().find((batch: { id: string }) => batch.id === draft.batchId).state).toBe(
      "withdrawn",
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, batchId: draft.batchId });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/salary-batches/${draft.batchId}`,
          headers: { cookie: admin },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("deletes a partially sent batch after every delivered item is withdrawn", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin, [
      { userId: "employee-a", name: "员工A", 实发金额: 9000 },
      { userId: "employee-b", name: "员工B", 实发金额: 8000 },
    ]);
    const [sentItem] = draft.detail.items;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/salary-batches/${draft.batchId}/items/${sentItem!.id}/send`,
          headers: { cookie: admin },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/salary-batches/${draft.batchId}/items/${sentItem!.id}/withdraw`,
          headers: { cookie: admin },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    const summaries = await app.inject({
      method: "GET",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
    });
    expect(
      summaries
        .json()
        .find((batch: { id: string }) => batch.id === draft.batchId),
    ).toMatchObject({ withdrawn: 1, canDelete: true });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, batchId: draft.batchId });
    await app.close();
  });

  it("does not mark a batch withdrawn when an earlier delivery has an unresolved resend failure", async () => {
    const { app, dingtalk } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin, [
      { userId: "employee-a", name: "员工A", 实发金额: 9000 },
      { userId: "employee-b", name: "员工B", 实发金额: 8000 },
    ]);
    const [first, second] = draft.detail.items;

    for (const item of [first, second]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/salary-batches/${draft.batchId}/items/${item!.id}/send`,
            headers: { cookie: admin },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/salary-batches/${draft.batchId}/items/${first!.id}/withdraw`,
          headers: { cookie: admin },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    dingtalk.sendWorkNotification = async () => {
      throw new Error("notification_failed");
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/salary-batches/${draft.batchId}/items/${first!.id}/send`,
          headers: { cookie: admin },
          payload: {},
        })
      ).statusCode,
    ).toBe(500);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/salary-batches/${draft.batchId}/items/${second!.id}/withdraw`,
          headers: { cookie: admin },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    const summary = (
      await app.inject({
        method: "GET",
        url: "/v1/salary-batches",
        headers: { cookie: admin },
      })
    )
      .json()
      .find((batch: { id: string }) => batch.id === draft.batchId);
    expect(summary).toMatchObject({ state: "sent", withdrawn: 1, canDelete: false });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().code).toBe("salary_batch_not_deletable");
    await app.close();
  });

  it("deletes a fully withdrawn batch even after employees viewed and confirmed it", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const created = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "已查收后撤回删除测试",
        rows: [
          { userId: "employee-a", name: "员工A", 实发金额: 9000 },
          { userId: "employee-b", name: "员工B", 实发金额: 8000 },
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
    expect(created.statusCode).toBe(200);
    const batchId = created.json().batchId as string;
    const detail = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    const items = detail.json().items as Array<{ id: string; employeeUserId: string }>;

    const sent = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(sent.statusCode).toBe(200);

    for (const employeeUserId of ["employee-a", "employee-b"]) {
      const employee = sessionCookie(
        await app.inject({
          method: "POST",
          url: "/v1/auth/dev",
          payload: { userId: employeeUserId },
        }),
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/me/salary-slips/${batchId}/view`,
            headers: { cookie: employee },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/me/salary-slips/${batchId}/confirm`,
            headers: { cookie: employee },
          })
        ).statusCode,
      ).toBe(200);
    }

    for (const item of items) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/salary-batches/${batchId}/items/${item.id}/withdraw`,
            headers: { cookie: admin },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    }

    const summaries = await app.inject({
      method: "GET",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
    });
    const summary = summaries
      .json()
      .find((batch: { id: string }) => batch.id === batchId);
    expect(summary).toMatchObject({ state: "withdrawn", viewed: 2, confirmed: 2 });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, batchId });
    await app.close();
  });

  it("blocks deleting a withdrawn batch after one item is resent", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin, [
      { userId: "employee-a", name: "员工A", 实发金额: 9000 },
      { userId: "employee-b", name: "员工B", 实发金额: 8000 },
    ]);
    const [first, second] = draft.detail.items;

    for (const item of [first, second]) {
      await app.inject({
        method: "POST",
        url: `/v1/salary-batches/${draft.batchId}/items/${item!.id}/send`,
        headers: { cookie: admin },
        payload: {},
      });
    }
    for (const item of [first, second]) {
      await app.inject({
        method: "POST",
        url: `/v1/salary-batches/${draft.batchId}/items/${item!.id}/withdraw`,
        headers: { cookie: admin },
        payload: {},
      });
    }

    const resent = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${first!.id}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(resent.statusCode).toBe(200);

    const summaries = await app.inject({
      method: "GET",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
    });
    expect(
      summaries
        .json()
        .find((batch: { id: string }) => batch.id === draft.batchId).state,
    ).not.toBe("withdrawn");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().code).toBe("salary_batch_not_deletable");
    await app.close();
  });

  it("keeps a withdrawn batch undeletable when a resend fails", async () => {
    const { app, dingtalk } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin, [
      { userId: "employee-a", name: "员工A", 实发金额: 9000 },
      { userId: "employee-b", name: "员工B", 实发金额: 8000 },
    ]);
    const [first, second] = draft.detail.items;

    for (const item of [first, second]) {
      await app.inject({
        method: "POST",
        url: `/v1/salary-batches/${draft.batchId}/items/${item!.id}/send`,
        headers: { cookie: admin },
        payload: {},
      });
      await app.inject({
        method: "POST",
        url: `/v1/salary-batches/${draft.batchId}/items/${item!.id}/withdraw`,
        headers: { cookie: admin },
        payload: {},
      });
    }

    dingtalk.sendWorkNotification = async () => {
      throw new Error("notification_failed");
    };
    const resend = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${first!.id}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(resend.statusCode).toBe(500);

    const summaries = await app.inject({
      method: "GET",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
    });
    expect(
      summaries
        .json()
        .find((batch: { id: string }) => batch.id === draft.batchId).state,
    ).not.toBe("withdrawn");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().code).toBe("salary_batch_not_deletable");
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

  it("rejects editing a withdrawn item after its batch is archived", async () => {
    const { app, store } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);
    const itemId = draft.detail.items[0].id;

    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });
    store.archiveExpired("2026-09");

    const before = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}`,
      headers: { cookie: admin },
      payload: { fields: { 实发金额: 9100 } },
    });
    const after = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });

    expect(edited.statusCode).toBe(409);
    expect(edited.json().code).toBe("salary_item_not_editable");
    expect(after.json().items[0].fields).toEqual(before.json().items[0].fields);
    await app.close();
  });

  it("rejects deleting a batch while a single-item send is in flight", async () => {
    const { app, dingtalk } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);
    const itemId = draft.detail.items[0].id;
    const gate = deferred<{ taskId: string }>();
    const started = deferred<void>();
    dingtalk.sendWorkNotification = async () => {
      started.resolve();
      return gate.promise;
    };

    const sending = app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    await started.promise;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    gate.resolve({ taskId: "notice-in-flight-delete" });
    const sent = await sending;
    const remaining = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });

    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().code).toBe("salary_batch_not_deletable");
    expect(sent.statusCode).toBe(200);
    expect(remaining.statusCode).toBe(200);
    await app.close();
  });

  it("rejects editing an item while its resend is in flight", async () => {
    const { app, dingtalk } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await createDraft(app, admin);
    const itemId = draft.detail.items[0].id;
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });
    const before = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });
    const gate = deferred<{ taskId: string }>();
    const started = deferred<void>();
    dingtalk.sendWorkNotification = async () => {
      started.resolve();
      return gate.promise;
    };

    const resending = app.inject({
      method: "POST",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    await started.promise;
    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/salary-batches/${draft.batchId}/items/${itemId}`,
      headers: { cookie: admin },
      payload: { fields: { 实发金额: 9100 } },
    });
    gate.resolve({ taskId: "notice-in-flight-edit" });
    const resent = await resending;
    const after = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${draft.batchId}`,
      headers: { cookie: admin },
    });

    expect(edited.statusCode).toBe(409);
    expect(edited.json().code).toBe("salary_item_not_editable");
    expect(resent.statusCode).toBe(200);
    expect(after.json().items[0].fields).toEqual(before.json().items[0].fields);
    await app.close();
  });
});
