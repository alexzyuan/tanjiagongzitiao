import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import { MockDingTalkClient, HttpDingTalkClient } from "@salary/dingtalk";
import { MemorySalaryStore } from "@salary/db";
import { config } from "./config.js";
import { SessionService } from "./modules/auth/session.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { AuditService } from "./modules/audit/service.js";
import { AuthorizationService } from "./modules/authorization/service.js";
import { SalaryService } from "./modules/salary/service.js";
import { registerSalaryRoutes } from "./modules/salary/routes.js";
import { registerReportRoutes } from "./modules/reports/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: () => randomUUID() });
  const store = new MemorySalaryStore(Buffer.from(config.SALARY_ENCRYPTION_KEY, "hex"));
  const dingtalk = config.DINGTALK_MODE === "mock" ? new MockDingTalkClient() : new HttpDingTalkClient({ clientId: config.DINGTALK_CLIENT_ID, clientSecret: config.DINGTALK_CLIENT_SECRET });
  const sessions = new SessionService(config.SESSION_SIGNING_KEY);
  const audit = new AuditService(store);
  const authz = new AuthorizationService(store);
  const salary = new SalaryService(store, dingtalk, audit, config.APP_BASE_URL);

  app.register(cookie);
  app.register(cors, { origin: config.APP_BASE_URL, credentials: true });
  app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
  app.register(sensible);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: "invalid_request", issues: error.issues });
    const message = error instanceof Error ? error.message : "internal_error";
    if (message.startsWith("session_")) return reply.code(401).send({ code: message });
    const statusCode = message === "salary_item_archived" || message.startsWith("salary_batch_not_found") || message.startsWith("salary_item_not_found") ? 404
      : message.includes("access_denied") || message.endsWith("_required") ? 403
      : error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "unhandled_salary_api_error");
    return reply.code(statusCode).send({ code: message, requestId: request.id });
  });
  app.get("/healthz", async () => ({ ok: true, service: "salary-api" }));
  registerAuthRoutes(app, { dingtalk, sessions });
  registerSalaryRoutes(app, { sessions, authz, salary });
  registerReportRoutes(app, { sessions, authz, store, audit });
  registerSettingsRoutes(app, { sessions, authz, store, audit });
  return { app, store, dingtalk, sessions, audit, authz, salary };
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const { app } = buildApp();
  app.listen({ port: config.PORT, host: "0.0.0.0" }).catch(error => { app.log.error(error); process.exitCode = 1; });
}
