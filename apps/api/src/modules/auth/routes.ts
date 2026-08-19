import type { FastifyInstance } from "fastify";
import type { DingTalkClient } from "@salary/dingtalk";
import { z } from "zod";
import { SESSION_MAX_AGE_MS, SessionService } from "./session.js";

const AuthCodeSchema = z.object({ authCode: z.string().min(1) });
const DevAuthSchema = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  corpId: z.string().min(1).optional()
});

export function registerAuthRoutes(app: FastifyInstance, deps: {
  dingtalk: DingTalkClient;
  sessions: SessionService;
  mode: "mock" | "http";
  corpId: string;
  clientId: string;
  secureCookie: boolean;
}): void {
  app.get("/v1/auth/config", async () => ({ mode: deps.mode, corpId: deps.corpId, clientId: deps.clientId }));

  app.post("/v1/auth/dingtalk", async (request, reply) => {
    const input = AuthCodeSchema.parse(request.body);
    const identity = await deps.dingtalk.exchangeAuthCode(input.authCode);
    const token = deps.sessions.create(identity);
    reply.setCookie("salary_session", token, { httpOnly: true, sameSite: "lax", secure: deps.secureCookie, path: "/", maxAge: SESSION_MAX_AGE_MS / 1000 });
    return reply.code(201).send({ userId: identity.userId, name: identity.name, corpId: identity.corpId });
  });

  app.post("/v1/auth/dev", async (request, reply) => {
    if (process.env.NODE_ENV === "production" || deps.mode === "http") return reply.code(404).send({ code: "route_not_found" });
    const input = DevAuthSchema.parse(request.body ?? {});
    const identity = input.userId
      ? { userId: input.userId, corpId: input.corpId ?? "dev-corp", name: input.name ?? input.userId }
      : await deps.dingtalk.exchangeAuthCode("mock-code");
    const token = deps.sessions.create(identity);
    reply.setCookie("salary_session", token, { httpOnly: true, sameSite: "lax", secure: deps.secureCookie, path: "/", maxAge: SESSION_MAX_AGE_MS / 1000 });
    return reply.code(201).send({ userId: identity.userId, name: identity.name, corpId: identity.corpId });
  });

  app.get("/v1/auth/session", async (request) => {
    const identity = deps.sessions.read(request.cookies.salary_session);
    return { userId: identity.userId, name: identity.name, corpId: identity.corpId };
  });
}
