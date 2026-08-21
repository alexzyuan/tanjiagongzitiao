export function errorText(reason: unknown) {
  const error =
    reason instanceof Error
      ? reason
      : new Error(typeof reason === "string" ? reason : "unknown_error");
  console.error("salary_ui_error", error.message);
  if (error.message === "dingtalk_rate_limited")
    return "通讯录查询频繁，请稍后重试。";
  return error.message;
}
