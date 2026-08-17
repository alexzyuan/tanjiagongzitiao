import { describe, expect, it } from "vitest";
import { HttpDingTalkClient } from "../src/client.js";

describe("HTTP DingTalk client", () => {
  it("exchanges identity, sends a link work notice, and creates a personal todo", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1.0/oauth2/userAccessToken")) return json({ accessToken: "user-token", expireIn: 7200, corpId: "corp-1" });
      if (url.endsWith("/v1.0/contact/users/me")) return json({ userId: "employee-a", unionId: "union-a", name: "员工A" });
      if (url.includes("/gettoken")) return json({ errcode: 0, access_token: "app-token", expires_in: 7200 });
      if (url.includes("/topapi/message/corpconversation/asyncsend_v2")) return json({ errcode: 0, task_id: "notice-1" });
      if (url.endsWith("/v1.0/todo/users/me/personalTasks")) return json({ taskId: "todo-1" });
      throw new Error(`unexpected_url:${url}`);
    };
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", agentId: 42, fetchImpl });

    await expect(client.exchangeAuthCode("oauth-code")).resolves.toEqual({ userId: "employee-a", corpId: "corp-1", name: "员工A" });
    await expect(client.sendWorkNotification({ userId: "employee-a", title: "2026-08工资条", body: "请在钉钉内查看工资明细", url: "https://salary.example/employee/salary-slips/batch-1" })).resolves.toEqual({ taskId: "notice-1" });
    await expect(client.createTodo({ userId: "employee-a", subject: "2026-08工资条待查看", url: "https://salary.example/employee/salary-slips/batch-1" })).resolves.toEqual({ todoId: "todo-1" });

    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      "/v1.0/oauth2/userAccessToken",
      "/v1.0/contact/users/me",
      "/gettoken",
      "/topapi/message/corpconversation/asyncsend_v2",
      "/v1.0/todo/users/me/personalTasks"
    ]);
    const noticeBody = String(calls[3]?.init.body);
    expect(noticeBody).toContain("agent_id=42");
    expect(noticeBody).toContain("userid_list=employee-a");
    expect(noticeBody).not.toContain("金额");
    const todoBody = JSON.parse(String(calls[4]?.init.body)) as { executorIds: string[]; description: string };
    expect(todoBody.executorIds).toEqual(["union-a"]);
    expect(todoBody.description).toContain("salary.example/employee/salary-slips/batch-1");
  });

  it("fails explicitly when work notification configuration is incomplete", async () => {
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl: async () => json({}) });
    await expect(client.sendWorkNotification({ userId: "employee-a", title: "工资条", body: "查看明细", url: "https://salary.example" })).rejects.toThrow("dingtalk_agent_id_missing");
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
