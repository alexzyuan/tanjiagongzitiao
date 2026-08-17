import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SessionService } from "../auth/session.js";
import type { AuthorizationService } from "../authorization/service.js";
import { SalaryService } from "./service.js";

const DraftSchema = z.object({ payrollMonth: z.string().regex(/^\d{4}-\d{2}$/), title: z.string().min(1), rows: z.array(z.record(z.unknown())).min(1) });
const ScheduleSchema = z.object({ scheduledAt: z.string().datetime().optional() });

function user(request: FastifyRequest, sessions: SessionService) { return sessions.read(request.cookies.salary_session); }

export function registerSalaryRoutes(app: FastifyInstance, deps: { sessions: SessionService; authz: AuthorizationService; salary: SalaryService }): void {
  app.get("/v1/salary-batches", async request => deps.salary.list(deps.authz.accessFor(user(request, deps.sessions).userId)));
  app.post("/v1/salary-batches", async request => {
    const identity = user(request, deps.sessions);
    const access = deps.authz.accessFor(identity.userId);
    if (access.kind !== "main_admin" && access.kind !== "sub_admin" && access.kind !== "batch_admin") throw new Error("salary_admin_required");
    return deps.salary.createDraft(identity.userId, DraftSchema.parse(request.body));
  });
  app.get("/v1/salary-batches/:batchId", async request => {
    const identity = user(request, deps.sessions);
    return deps.salary.getBatch(deps.authz.accessFor(identity.userId), (request.params as { batchId: string }).batchId);
  });
  app.post("/v1/salary-batches/:batchId/send", async request => {
    const identity = user(request, deps.sessions);
    return deps.salary.send(deps.authz.accessFor(identity.userId), (request.params as { batchId: string }).batchId, ScheduleSchema.parse(request.body).scheduledAt);
  });
  app.post("/v1/salary-batches/:batchId/resend", async request => {
    const identity = user(request, deps.sessions);
    return deps.salary.resend(deps.authz.accessFor(identity.userId), (request.params as { batchId: string }).batchId);
  });
  app.post("/v1/salary-batches/:batchId/withdraw", async request => {
    const identity = user(request, deps.sessions);
    return deps.salary.withdraw(deps.authz.accessFor(identity.userId), (request.params as { batchId: string }).batchId);
  });
  app.post("/v1/salary-batches/:batchId/admins", async request => {
    const identity = user(request, deps.sessions);
    const body = z.object({ userId: z.string().min(1) }).parse(request.body);
    return deps.salary.assignAdmin(deps.authz.accessFor(identity.userId), (request.params as { batchId: string }).batchId, body.userId);
  });
}
