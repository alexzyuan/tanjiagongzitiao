import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

describe("auth", () => {
  afterEach(() => { process.env.DINGTALK_MODE = "mock"; });

  it("creates a signed session from the mock DingTalk auth code", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/auth/dingtalk", payload: { authCode: "mock-code" } });
    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("salary_session="));
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
});
