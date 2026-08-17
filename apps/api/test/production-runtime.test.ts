import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production runtime", () => {
  it("starts the compiled API with native Node.js and explicit production configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "salary-production-runtime-"));
    const child = spawn(process.execPath, ["dist/server.js"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "3919",
        APP_BASE_URL: "https://salary.example.test",
        DINGTALK_MODE: "http",
        DINGTALK_CLIENT_ID: "test-client",
        DINGTALK_CLIENT_SECRET: "test-secret",
        DINGTALK_CORP_ID: "test-corp",
        DINGTALK_AGENT_ID: "1",
        MAIN_ADMIN_USER_ID: "test-admin",
        SESSION_SIGNING_KEY: "test-session-signing-key",
        SALARY_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        SALARY_DATABASE_PATH: join(directory, "salary-slip.sqlite")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    let exited = false;
    child.once("exit", () => { exited = true; });
    try {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(([code]) => Promise.reject(new Error(`compiled_api_exited:${code}:${output}`)))
      ]);
      expect(output).toContain("Server listening at");
    } finally {
      if (!exited) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
