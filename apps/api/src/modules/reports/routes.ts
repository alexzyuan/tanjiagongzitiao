import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DingTalkClient } from "@salary/dingtalk";
import type { SessionService } from "../auth/session.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { SalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";
import { EvidenceService, type EvidenceFilters } from "./evidence.js";
import { ReportService } from "./service.js";

const EvidenceListQuerySchema = z
  .object({
    employmentStatus: z.enum(["active", "departed"]).optional(),
    query: z.string().trim().max(120).optional(),
  })
  .strict();
const EvidenceFiltersSchema = z
  .object({
    fromMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    toMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    sendStatus: z
      .enum(["not_sent", "sent", "failed", "withdrawn"])
      .optional(),
    viewStatus: z.enum(["not_viewed", "viewed"]).optional(),
    confirmStatus: z.enum(["not_confirmed", "confirmed"]).optional(),
  })
  .strict();
const EvidenceExportSchema = EvidenceFiltersSchema.extend({
  employeeUserId: z.string().trim().min(1).max(200),
  fields: z.array(z.string().trim().min(1).max(120)).max(300),
}).strict();

function identity(request: FastifyRequest, sessions: SessionService) { return sessions.read(request.cookies.salary_session); }

export function registerReportRoutes(app: FastifyInstance, deps: { sessions: SessionService; authz: AuthorizationService; store: SalaryStore; audit: AuditService; dingtalk: DingTalkClient }): void {
  const reports = new ReportService(deps.store);
  const evidence = new EvidenceService(deps.store, deps.dingtalk, deps.audit);
  app.get("/v1/reports/summary", async request => {
    const actor = identity(request, deps.sessions);
    const query = reportQuerySchema.parse(request.query);
    return reports.summary(
      deps.authz.accessFor(actor.userId),
      query.payrollMonth,
      reportRange(query),
    );
  });
  app.get("/v1/reports/summary.csv", async (request, reply) => {
    const actor = identity(request, deps.sessions);
    const query = reportQuerySchema.parse(request.query);
    const access = deps.authz.accessFor(actor.userId);
    const report = reports.summary(
      access,
      query.payrollMonth,
      reportRange(query),
    );
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="salary-report.csv"');
    const csv = reports.csv(access, query.payrollMonth, reportRange(query));
    deps.audit.record({ correlationId: `report:${actor.userId}:${Date.now()}`, actorUserId: actor.userId, action: "report.export", targetType: "report", targetId: "salary-summary", outcome: "completed", metadata: { payrollMonth: query.payrollMonth ?? null, rowCount: report.batches.length } });
    return csv;
  });
  app.get("/v1/reports/employees.csv", async (request, reply) => {
    const actor = identity(request, deps.sessions);
    const query = reportQuerySchema.parse(request.query);
    const access = deps.authz.accessFor(actor.userId);
    const csv = reports.employeeCsv(
      access,
      query.payrollMonth,
      reportRange(query),
    );
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      'attachment; filename="salary-employee-summary.csv"',
    );
    deps.audit.record({
      correlationId: `report:${actor.userId}:${Date.now()}`,
      actorUserId: actor.userId,
      action: "report.export",
      targetType: "report",
      targetId: "salary-employee-summary",
      outcome: "completed",
      metadata: {
        payrollMonth: query.payrollMonth ?? null,
      },
    });
    return csv;
  });
  app.get("/v1/payment-evidence", async request => {
    const actor = identity(request, deps.sessions);
    const access = deps.authz.accessFor(actor.userId);
    if (access.kind !== "main_admin") throw new Error("main_admin_required");
    const query = z.object({ batchId: z.string().min(1).optional() }).parse(request.query);
    return deps.store.listEvidence(query.batchId);
  });
  app.get("/v1/payment-evidence/employees", async (request) => {
    const actor = identity(request, deps.sessions);
    const query = EvidenceListQuerySchema.parse(request.query);
    return evidence.listEmployees(
      deps.authz.accessFor(actor.userId),
      {
        ...(query.employmentStatus
          ? { employmentStatus: query.employmentStatus }
          : {}),
        ...(query.query ? { query: query.query } : {}),
      },
    );
  });
  app.get(
    "/v1/payment-evidence/employees/:employeeUserId",
    async (request) => {
      const actor = identity(request, deps.sessions);
      const params = request.params as { employeeUserId: string };
      const filters = EvidenceFiltersSchema.parse(request.query);
      return evidence.getEmployeeDetail(
        deps.authz.accessFor(actor.userId),
        params.employeeUserId,
        normalizeEvidenceFilters(filters),
      );
    },
  );
  app.post("/v1/payment-evidence/export.xlsx", async (request, reply) => {
    const actor = identity(request, deps.sessions);
    const body = EvidenceExportSchema.parse(request.body);
    const buffer = await evidence.exportXlsx(
      deps.authz.accessFor(actor.userId),
      {
        employeeUserId: body.employeeUserId,
        fields: body.fields,
        ...normalizeEvidenceFilters(body),
      },
    );
    reply.header(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    reply.header(
      "content-disposition",
      'attachment; filename="payment-evidence.xlsx"',
    );
    return reply.send(buffer);
  });
  app.get("/v1/audits", async request => {
    const actor = identity(request, deps.sessions);
    if (deps.authz.accessFor(actor.userId).kind !== "main_admin") throw new Error("main_admin_required");
    return deps.store.listAudits();
  });
}

const reportQuerySchema = z
  .object({
    payrollMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    fromMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    toMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.fromMonth && query.toMonth && query.fromMonth > query.toMonth) {
      context.addIssue({
        code: "custom",
        path: ["toMonth"],
        message: "fromMonth_must_not_exceed_toMonth",
      });
    }
  });

function reportRange(query: z.infer<typeof reportQuerySchema>) {
  return {
    ...(query.fromMonth ? { fromMonth: query.fromMonth } : {}),
    ...(query.toMonth ? { toMonth: query.toMonth } : {}),
  };
}

function normalizeEvidenceFilters(
  input: z.infer<typeof EvidenceFiltersSchema>,
): EvidenceFilters {
  return {
    ...(input.fromMonth ? { fromMonth: input.fromMonth } : {}),
    ...(input.toMonth ? { toMonth: input.toMonth } : {}),
    ...(input.sendStatus ? { sendStatus: input.sendStatus } : {}),
    ...(input.viewStatus ? { viewStatus: input.viewStatus } : {}),
    ...(input.confirmStatus ? { confirmStatus: input.confirmStatus } : {}),
  };
}
