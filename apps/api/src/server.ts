import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { MockDingTalkClient, HttpDingTalkClient } from "@salary/dingtalk";
import { SqliteSalaryStore } from "@salary/db";
import { config } from "./config.js";
import { SessionService } from "./modules/auth/session.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { AuditService } from "./modules/audit/service.js";
import { AuthorizationService } from "./modules/authorization/service.js";
import { SalaryService } from "./modules/salary/service.js";
import { registerSalaryRoutes } from "./modules/salary/routes.js";
import { registerReportRoutes } from "./modules/reports/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";

export function buildApp(options: { databasePath?: string } = {}) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: () => randomUUID(),
  });
  const store = new SqliteSalaryStore(
    options.databasePath ?? config.SALARY_DATABASE_PATH,
    Buffer.from(config.SALARY_ENCRYPTION_KEY, "hex"),
  );
  const dingtalk =
    config.DINGTALK_MODE === "mock"
      ? new MockDingTalkClient()
      : new HttpDingTalkClient({
          clientId: config.DINGTALK_CLIENT_ID,
          clientSecret: config.DINGTALK_CLIENT_SECRET,
          corpId: config.DINGTALK_CORP_ID,
          agentId: config.DINGTALK_AGENT_ID,
          apiBaseUrl: config.DINGTALK_API_BASE_URL,
          legacyApiBaseUrl: config.DINGTALK_LEGACY_API_BASE_URL,
          notificationPicUrl: `${config.APP_BASE_URL}/salary-notification.svg`,
          onEvent: (event, fields) =>
            app.log.info({ integration: "dingtalk", ...fields }, event),
        });
  const sessions = new SessionService(config.SESSION_SIGNING_KEY);
  const audit = new AuditService(store);
  const authz = new AuthorizationService(store);
  const salary = new SalaryService(store, dingtalk, audit, config.APP_BASE_URL);

  app.register(cookie);
  app.register(cors, { origin: config.APP_BASE_URL, credentials: true });
  app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ code: "invalid_request", issues: error.issues });
    const message = error instanceof Error ? error.message : "internal_error";
    if (message.startsWith("session_"))
      return reply.code(401).send({ code: message });
    const statusCode =
      message === "salary_item_archived" ||
      message === "salary_item_withdrawn" ||
      message.startsWith("salary_batch_not_found") ||
      message.startsWith("salary_item_not_found") ||
      message === "salary_import_preview_not_found"
        ? 404
        : message.startsWith("salary_item_not_sendable:") ||
            message.startsWith("salary_batch_not_sendable:") ||
            message.startsWith("invalid_salary_batch_transition:") ||
            [
              "salary_item_already_sent",
              "salary_item_send_in_progress",
              "salary_item_not_withdrawable",
              "salary_confirmation_disabled",
            ].includes(message)
          ? 409
        : message.startsWith("dingtalk_api_error:identity.") ||
            message.startsWith("dingtalk_auth_code")
              ? 401
          : [
                "salary_visible_fields_required",
                "salary_net_amount_field_must_be_visible",
              ].includes(message)
            ? 400
          : message.includes("access_denied") || message.endsWith("_required")
            ? 403
            : message.startsWith("salary_import_") ||
                message.startsWith("salary_workbook_") ||
                message === "directory_user_not_found"
              ? 400
              : error &&
                  typeof error === "object" &&
                  "statusCode" in error &&
                  typeof error.statusCode === "number"
                ? error.statusCode
                : 500;
    if (statusCode >= 500)
      request.log.error({ err: error }, "unhandled_salary_api_error");
    return reply
      .code(statusCode)
      .send({ code: message, requestId: request.id });
  });
  app.addHook("onClose", () => store.close());
  app.get("/healthz", async () => ({ ok: true, service: "salary-api" }));
  registerAuthRoutes(app, {
    dingtalk,
    sessions,
    mode: config.DINGTALK_MODE,
    corpId: config.DINGTALK_CORP_ID,
    clientId: config.DINGTALK_CLIENT_ID,
    secureCookie: config.APP_BASE_URL.startsWith("https://"),
  });
  registerSalaryRoutes(app, { sessions, authz, salary, dingtalk });
  registerReportRoutes(app, { sessions, authz, store, audit });
  registerSettingsRoutes(app, { sessions, authz, store, audit });
  return { app, store, dingtalk, sessions, audit, authz, salary };
}

if (
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js")
) {
  const { app } = buildApp();
  app.listen({ port: config.PORT, host: "0.0.0.0" }).catch((error) => {
    app.log.error(error);
    process.exitCode = 1;
  });
}
