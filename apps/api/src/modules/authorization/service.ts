import type { Access } from "@salary/domain";
import type { SalaryStore } from "@salary/db";
import { config } from "../../config.js";

export class AuthorizationService {
  constructor(private readonly store: SalaryStore) {}

  accessFor(userId: string): Access {
    if (userId === config.MAIN_ADMIN_USER_ID) return { kind: "main_admin", userId };
    const batchIds = this.store.listBatchSummaries().filter(batch => batch.assignedAdminIds.includes(userId)).map(batch => batch.id);
    if (this.store.listSubAdmins().includes(userId)) return { kind: "sub_admin", userId, batchIds };
    if (batchIds.length > 0) return { kind: "batch_admin", userId, batchIds };
    return { kind: "employee", userId };
  }
}
