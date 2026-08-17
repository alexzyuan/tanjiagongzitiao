import { describe, expect, it } from "vitest";
import { MockDingTalkClient } from "../src/mock.js";

describe("mock DingTalk client", () => {
  it("records notification and todo payloads without salary amounts", async () => {
    const client = new MockDingTalkClient();
    await client.sendWorkNotification({ userId: "employee-a", title: "2026-08工资条", body: "请在钉钉内查看工资明细", url: "http://localhost:5173/employee/salary-slips/batch-1" });
    await client.createTodo({ userId: "employee-a", subject: "2026-08工资条待查看", url: "http://localhost:5173/employee/salary-slips/batch-1" });
    expect(client.notifications).toHaveLength(1);
    expect(client.notifications[0]?.body).not.toContain("金额");
    expect(client.todos).toHaveLength(1);
  });
});
