export type Access =
  | { kind: "main_admin"; userId: string }
  | { kind: "batch_admin"; userId: string; batchIds: string[] }
  | { kind: "sub_admin"; userId: string; batchIds: string[] }
  | { kind: "employee"; userId: string };

/**
 * Returns whether the access represents a global salary administrator.
 * The role distinction is retained for audit and UI semantics, while the
 * enterprise administrator and sub-administrators share salary permissions.
 */
export function isGlobalSalaryAdmin(access: Access): boolean {
  return access.kind === "main_admin" || access.kind === "sub_admin";
}

export function canManageBatch(access: Access, batchId: string): boolean {
  return isGlobalSalaryAdmin(access) ||
    (access.kind === "batch_admin" && access.batchIds.includes(batchId));
}

export function canReadArchive(access: Access): boolean {
  return isGlobalSalaryAdmin(access);
}

export function canManageSettings(access: Access): boolean {
  return isGlobalSalaryAdmin(access);
}

export function canReadEmployeeItem(access: Access, employeeUserId: string): boolean {
  return isGlobalSalaryAdmin(access) || (access.kind === "employee" && access.userId === employeeUserId);
}
