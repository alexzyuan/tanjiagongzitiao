export function errorText(reason: unknown) {
  const error =
    reason instanceof Error
      ? reason
      : new Error(typeof reason === "string" ? reason : "unknown_error");
  console.error("salary_ui_error", error.message);
  return error.message;
}
