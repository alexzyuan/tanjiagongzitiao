import type { Access } from "@salary/domain";
import type { MemorySalaryStore } from "@salary/db";
import { config } from "../../config.js";

export class AuthorizationService {
  constructor(private readonly store: MemorySalaryStore) {}

  accessFor(userId: string): Access {
    if (userId === config.MAIN_ADMIN_USER_ID) return { kind: "main_admin", userId };
    const batchIds = this.store.listBatches().filter(batch => batch.assignedAdminIds.includes(userId)).map(batch => batch.id);
    return { kind: "sub_admin", userId, batchIds };
  }
}
