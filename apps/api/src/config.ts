import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  DINGTALK_MODE: z.enum(["mock", "http"]).default("mock"),
  DINGTALK_CLIENT_ID: z.string().min(1).default("local-development-client"),
  DINGTALK_CLIENT_SECRET: z.string().min(1).default("local-development-secret"),
  DINGTALK_CORP_ID: z.string().min(1).default("dev-corp"),
  DINGTALK_AGENT_ID: z.coerce.number().int().positive().optional(),
  DINGTALK_API_BASE_URL: z.string().url().default("https://api.dingtalk.com"),
  DINGTALK_LEGACY_API_BASE_URL: z.string().url().default("https://oapi.dingtalk.com"),
  MAIN_ADMIN_USER_ID: z.string().min(1).default("dev-admin"),
  SESSION_SIGNING_KEY: z.string().min(16).default("local-development-session-signing-key"),
  SALARY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
  SALARY_DATABASE_PATH: z.string().min(1).default(process.env.NODE_ENV === "test" ? ":memory:" : "./data/salary-slip.sqlite")
});

const parsed = ConfigSchema.parse(process.env);
if (parsed.NODE_ENV === "production" && parsed.DINGTALK_MODE === "mock") throw new Error("production_requires_real_dingtalk_mode");
if (parsed.NODE_ENV === "production" && !process.env.SALARY_DATABASE_PATH) throw new Error("production_requires_salary_database_path");
if (parsed.DINGTALK_MODE === "http" && !parsed.DINGTALK_AGENT_ID) throw new Error("dingtalk_agent_id_required_for_http_mode");
export const config = parsed;
