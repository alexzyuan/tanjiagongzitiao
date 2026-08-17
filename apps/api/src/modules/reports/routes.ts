import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SessionService } from "../auth/session.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { MemorySalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";
import { ReportService } from "./service.js";

function identity(request: FastifyRequest, sessions: SessionService) { return sessions.read(request.cookies.salary_session); }

export function registerReportRoutes(app: FastifyInstance, deps: { sessions: SessionService; authz: AuthorizationService; store: MemorySalaryStore; audit: AuditService }): void {
  const reports = new ReportService(deps.store);
  app.get("/v1/reports/summary", async request => {
    const actor = identity(request, deps.sessions);
    const query = z.object({ payrollMonth: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query);
    return reports.summary(deps.authz.accessFor(actor.userId), query.payrollMonth);
  });
  app.get("/v1/reports/summary.csv", async (request, reply) => {
    const actor = identity(request, deps.sessions);
    const query = z.object({ payrollMonth: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query);
    const access = deps.authz.accessFor(actor.userId);
    const report = reports.summary(access, query.payrollMonth);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="salary-report.csv"');
    const csv = reports.csv(access, query.payrollMonth);
    deps.audit.record({ correlationId: `report:${actor.userId}:${Date.now()}`, actorUserId: actor.userId, action: "report.export", targetType: "report", targetId: "salary-summary", outcome: "completed", metadata: { payrollMonth: query.payrollMonth ?? null, rowCount: report.batches.length } });
    return csv;
  });
  app.get("/v1/payment-evidence", async request => {
    const actor = identity(request, deps.sessions);
    const access = deps.authz.accessFor(actor.userId);
    if (access.kind !== "main_admin") throw new Error("main_admin_required");
    const query = z.object({ batchId: z.string().min(1).optional() }).parse(request.query);
    return deps.store.listEvidence(query.batchId);
  });
  app.get("/v1/audits", async request => {
    const actor = identity(request, deps.sessions);
    if (deps.authz.accessFor(actor.userId).kind !== "main_admin") throw new Error("main_admin_required");
    return deps.store.listAudits();
  });
}
