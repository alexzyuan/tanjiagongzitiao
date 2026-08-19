export type Access =
  | { kind: "main_admin"; userId: string }
  | { kind: "batch_admin"; userId: string; batchIds: string[] }
  | { kind: "sub_admin"; userId: string; batchIds: string[] }
  | { kind: "employee"; userId: string };

export function canManageBatch(access: Access, batchId: string): boolean {
  return access.kind === "main_admin" ||
    ((access.kind === "batch_admin" || access.kind === "sub_admin") && access.batchIds.includes(batchId));
}

export function canReadArchive(access: Access): boolean {
  return access.kind === "main_admin";
}

export function canManageSettings(access: Access): boolean {
  return access.kind === "main_admin";
}

export function canReadEmployeeItem(access: Access, employeeUserId: string): boolean {
  return access.kind === "main_admin" || (access.kind === "employee" && access.userId === employeeUserId);
}
