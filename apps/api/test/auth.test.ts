import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/server.js";
import { SessionService } from "../src/modules/auth/session.js";

describe("auth", () => {
  afterEach(() => { process.env.DINGTALK_MODE = "mock"; });

  it("creates a signed session from the mock DingTalk auth code", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/auth/dingtalk", payload: { authCode: "mock-code" } });
    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("salary_session="));
    expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("Max-Age=28800"));
    await app.close();
  });

  it("exposes non-secret DingTalk client configuration", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/auth/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "mock", corpId: "dev-corp", clientId: "local-development-client" });
    await app.close();
  });

  it("rejects a missing session", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/auth/session" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("expires sessions after eight hours and rejects future-issued sessions", () => {
    vi.useFakeTimers();
    const sessions = new SessionService("test-session-signing-key");
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));
    const token = sessions.create({ userId: "employee-a", corpId: "dev-corp", name: "员工A" });
    vi.setSystemTime(new Date("2026-08-19T08:00:01.000Z"));
    expect(() => sessions.read(token)).toThrow("session_expired");

    vi.setSystemTime(new Date("2026-08-19T07:59:59.000Z"));
    const valid = sessions.create({ userId: "employee-a", corpId: "dev-corp", name: "员工A" });
    vi.setSystemTime(new Date("2026-08-19T07:59:58.000Z"));
    expect(() => sessions.read(valid)).toThrow("session_expired");
    vi.useRealTimers();
  });
});
