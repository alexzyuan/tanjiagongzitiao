import { describe, expect, it, vi } from "vitest";
import { HttpDingTalkClient } from "../src/client.js";

describe("HTTP DingTalk client", () => {
  it("exchanges an H5 auth code with the app token and sends a link work notice", async () => {
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
    expect(decodeURIComponent(noticeBody)).toContain('"msgtype":"link"');
    expect(decodeURIComponent(noticeBody)).toContain('"messageUrl":"https://salary.example/employee/salary-slips/batch-1"');
    expect(decodeURIComponent(noticeBody)).not.toContain("action_card");
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

  it("caches the directory snapshot and coalesces concurrent refreshes", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/gettoken")
        return json({ errcode: 0, access_token: "app-token", expires_in: 7200 });
      if (path === "/topapi/v2/department/listsubid") {
        const body = JSON.parse(String(init.body)) as { dept_id: number };
        return json({ errcode: 0, result: { dept_id_list: body.dept_id === 1 ? [2] : [] } });
      }
      if (path === "/topapi/user/listid") {
        const body = JSON.parse(String(init.body)) as { dept_id: number };
        return json({ errcode: 0, result: { has_more: false, userid_list: body.dept_id === 1 ? ["employee-a"] : [] } });
      }
      if (path === "/topapi/v2/user/get")
        return json({ errcode: 0, result: { userid: "employee-a", name: "员工A", active: true, dept_id_list: [1] } });
      throw new Error(`unexpected_url:${url}`);
    };
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl });

    const [first, second] = await Promise.all([
      client.listDirectoryUsers(),
      client.listDirectoryUsers(),
    ]);
    const third = await client.listDirectoryUsers();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(calls.filter((path) => path === "/topapi/v2/department/listsubid")).toHaveLength(2);
    expect(calls.filter((path) => path === "/topapi/user/listid")).toHaveLength(2);
    expect(calls.filter((path) => path === "/topapi/v2/user/get")).toHaveLength(1);
    expect(calls.filter((path) => path === "/gettoken")).toHaveLength(1);
  });

  it("refreshes the directory snapshot after fourteen days", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const fetchImpl: typeof fetch = async (input, init = {}) => {
        const url = String(input);
        const path = new URL(url).pathname;
        calls.push(path);
        if (path === "/gettoken")
          return json({ errcode: 0, access_token: "app-token", expires_in: 7200 });
        if (path === "/topapi/v2/department/listsubid") {
          const body = JSON.parse(String(init.body)) as { dept_id: number };
          return json({ errcode: 0, result: { dept_id_list: body.dept_id === 1 ? [2] : [] } });
        }
        if (path === "/topapi/user/listid")
          return json({ errcode: 0, result: { has_more: false, userid_list: ["employee-a"] } });
        if (path === "/topapi/v2/user/get")
          return json({ errcode: 0, result: { userid: "employee-a", name: "员工A", active: true, dept_id_list: [1] } });
        throw new Error(`unexpected_url:${url}`);
      };
      const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl });

      await client.listDirectoryUsers();
      await vi.advanceTimersByTimeAsync(14 * 24 * 60 * 60 * 1000 - 1);
      await client.listDirectoryUsers();
      expect(calls.filter((path) => path === "/topapi/v2/department/listsubid")).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(2);
      await client.listDirectoryUsers();
      expect(calls.filter((path) => path === "/topapi/v2/department/listsubid")).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("looks up one directory user without crawling every department", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/gettoken")
        return json({ errcode: 0, access_token: "app-token", expires_in: 7200 });
      if (path === "/topapi/v2/user/get") {
        const body = JSON.parse(String(init.body)) as { userid: string };
        return json({ errcode: 0, result: { userid: body.userid, name: "员工A", active: true, dept_id_list: [1] } });
      }
      throw new Error(`unexpected_url:${url}`);
    };
    const client = new HttpDingTalkClient({ clientId: "app-key", clientSecret: "app-secret", corpId: "corp-1", fetchImpl });

    await expect(client.getDirectoryUser("employee-a")).resolves.toEqual({
      userId: "employee-a",
      name: "员工A",
      departmentIds: [1],
    });
    expect(calls).toEqual(["/gettoken", "/topapi/v2/user/get"]);
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
