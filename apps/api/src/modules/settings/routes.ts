import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SessionService } from "../auth/session.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { AppSettings, MemorySalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";

const SettingsPatch = z.object({
  employeeVisibilityMonths: z.literal(12).optional(),
  passwordVerification: z.boolean().optional(),
  notificationMode: z.enum(["work_notice", "work_notice_with_todo"]).optional(),
  payrollReminder: z.boolean().optional(),
  employeeOnlyView: z.boolean().optional()
});

function actor(request: FastifyRequest, sessions: SessionService, authz: AuthorizationService) {
  const identity = sessions.read(request.cookies.salary_session);
  const access = authz.accessFor(identity.userId);
  if (access.kind !== "main_admin") throw new Error("main_admin_required");
  return identity;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: { sessions: SessionService; authz: AuthorizationService; store: MemorySalaryStore; audit: AuditService }): void {
  app.get("/v1/settings", async request => {
    actor(request, deps.sessions, deps.authz);
    return deps.store.getSettings();
  });
  app.patch("/v1/settings", async request => {
    const identity = actor(request, deps.sessions, deps.authz);
    const patch = SettingsPatch.parse(request.body);
    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<AppSettings>;
    const value = deps.store.setSettings(cleanPatch);
    deps.audit.record({ correlationId: `settings:${identity.userId}`, actorUserId: identity.userId, action: "settings.update", targetType: "app_settings", targetId: "global", outcome: "completed", metadata: cleanPatch });
    return value;
  });
}
