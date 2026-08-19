import type { SalaryStore } from "@salary/db";

export function archiveExpiredSalarySlips(store: SalaryStore, now = new Date()): { cutoffPayrollMonth: string; archivedBatchIds: string[] } {
  const months = store.getSettings().employeeVisibilityMonths;
  if (!Number.isInteger(months) || months < 1) throw new Error("employee_visibility_months_invalid");
  const cutoff = monthOffset(now, -(months - 1));
  const archivedBatchIds = store.archiveExpired(cutoff);
  if (archivedBatchIds.length > 0) console.info("salary_archive_completed", { cutoffPayrollMonth: cutoff, archivedBatchIds });
  return { cutoffPayrollMonth: cutoff, archivedBatchIds };
}

function monthOffset(now: Date, offset: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
