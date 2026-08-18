import { describe, expect, it } from "vitest";
import { HttpDingTalkClient } from "../src/client.js";

describe("HTTP DingTalk client", () => {
  it("exchanges an H5 auth code with the app token and sends a large action-card work notice", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/gettoken")) return json({ errcode: 0, access_token: "app-token", expires_in: 7200 });
      if (url.includes("/topapi/v2/user/getuserinfo")) return json({ errcode: 0, errmsg: "ok", result: { userid: "employee-a", unionid: "union-a", name: "员工A" } });
      if (url.includes("/topapi/message/corpconversation/asyncsend_v2")) return json({ errcode: 0, task_id: "notice-1" });
      throw new Error(`unexpected_url:${url}`);
    };
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", agentId: 42, notificationPicUrl: "https://salary.example/salary-notification.svg", fetchImpl });

    await expect(client.exchangeAuthCode("h5-auth-code")).resolves.toEqual({ userId: "employee-a", corpId: "corp-1", name: "员工A" });
    await expect(client.sendWorkNotification({ userId: "employee-a", title: "2026-08工资条", body: "请在钉钉内查看工资明细", url: "https://salary.example/employee/salary-slips/batch-1" })).resolves.toEqual({ taskId: "notice-1" });

    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      "/gettoken",
      "/topapi/v2/user/getuserinfo",
      "/topapi/message/corpconversation/asyncsend_v2",
    ]);
    const identityBody = JSON.parse(String(calls[1]?.init.body)) as { code: string };
    expect(identityBody).toEqual({ code: "h5-auth-code" });
    const noticeBody = String(calls[2]?.init.body);
    expect(noticeBody).toContain("agent_id=42");
    expect(noticeBody).toContain("userid_list=employee-a");
    expect(decodeURIComponent(noticeBody)).toContain("salary-notification.svg");
    expect(decodeURIComponent(noticeBody)).toContain("action_card");
    expect(decodeURIComponent(noticeBody)).toContain("查看明细");
    expect(decodeURIComponent(noticeBody)).toContain("btn_json");
    expect(decodeURIComponent(noticeBody)).not.toContain("single_title");
    expect(noticeBody).not.toContain("金额");
  });

  it("fails explicitly when personal todo lacks a user access token", async () => {
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl: async () => json({}) });
    await expect(client.createTodo({ userId: "employee-a", subject: "工资条", url: "https://salary.example" })).rejects.toThrow("dingtalk_user_token_missing_for_todo:employee-a");
  });

  it("fails explicitly when work notification configuration is incomplete", async () => {
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl: async () => json({}) });
    await expect(client.sendWorkNotification({ userId: "employee-a", title: "工资条", body: "查看明细", url: "https://salary.example" })).rejects.toThrow("dingtalk_agent_id_missing");
  });

  it("lists active organization users with employee numbers", async () => {
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.includes("/gettoken")) return json({ errcode: 0, access_token: "app-token", expires_in: 7200 });
      if (url.includes("/topapi/v2/department/listsubid")) return json({ errcode: 0, result: { dept_id_list: [2] } });
      if (url.includes("/topapi/user/listid")) {
        const body = JSON.parse(String(init.body)) as { dept_id: number };
        return json({ errcode: 0, result: { has_more: false, userid_list: body.dept_id === 1 ? ["employee-a"] : ["employee-b"] } });
      }
      if (url.includes("/topapi/v2/user/get")) {
        const body = JSON.parse(String(init.body)) as { userid: string };
        return json({ errcode: 0, result: body.userid === "employee-a" ? { userid: "employee-a", name: "员工A", job_number: "A001", title: "财务", dept_id_list: [1], active: true } : { userid: "employee-b", name: "员工B", job_number: "B001", title: "运营", dept_id_list: [2], active: true } });
      }
      throw new Error(`unexpected_url:${url}`);
    };
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl });

    await expect(client.listDirectoryUsers()).resolves.toEqual([
      { userId: "employee-a", name: "员工A", employeeNo: "A001", position: "财务", departmentIds: [1] },
      { userId: "employee-b", name: "员工B", employeeNo: "B001", position: "运营", departmentIds: [2] }
    ]);
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
