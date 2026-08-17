import type { SalaryStore } from "@salary/db";

export class AuditService {
  constructor(private readonly store: SalaryStore) {}

  record(input: { correlationId: string; actorUserId?: string; action: string; targetType: string; targetId: string; outcome: "accepted" | "completed" | "denied" | "failed"; metadata?: Record<string, unknown> }): void {
    this.store.recordAudit({ ...input, metadata: input.metadata ?? {} });
  }
}
