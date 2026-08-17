import { createHash } from "node:crypto";
import type { DingTalkClient, DingTalkIdentity, TodoTask, WorkNotification } from "./types.js";

export interface HttpDingTalkConfig {
  clientId: string;
  clientSecret: string;
  corpId: string;
  agentId?: number | undefined;
  apiBaseUrl?: string;
  legacyApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface CachedUserToken extends CachedToken {
  unionId: string;
}

type JsonObject = Record<string, unknown>;

const DEFAULT_API_BASE_URL = "https://api.dingtalk.com";
const DEFAULT_LEGACY_API_BASE_URL = "https://oapi.dingtalk.com";
const TOKEN_SKEW_MS = 60_000;

/**
 * Official DingTalk HTTP adapter.
 *
 * The adapter deliberately does not fall back to mock behavior. A failed
 * remote call raises a stable error code and emits an operation/status trace
 * without logging credentials or access tokens.
 */
export class HttpDingTalkClient implements DingTalkClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly legacyApiBaseUrl: string;
  private appToken?: CachedToken;
  private readonly userTokens = new Map<string, CachedUserToken>();

  constructor(private readonly config: HttpDingTalkConfig) {
    if (!config.clientId || !config.clientSecret) throw new Error("dingtalk_client_credentials_missing");
    if (!config.corpId) throw new Error("dingtalk_corp_id_missing");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.apiBaseUrl = trimBaseUrl(config.apiBaseUrl ?? DEFAULT_API_BASE_URL);
    this.legacyApiBaseUrl = trimBaseUrl(config.legacyApiBaseUrl ?? DEFAULT_LEGACY_API_BASE_URL);
  }

  async exchangeAuthCode(code: string): Promise<DingTalkIdentity> {
    if (!code) throw new Error("dingtalk_auth_code_missing");
    this.trace("identity.auth_code.received", {
      length: code.length,
      fingerprint: createHash("sha256").update(code).digest("hex").slice(0, 12)
    });
    const token = await this.getUserToken(code);
    const user = await this.requestJson("identity.lookup", `${this.apiBaseUrl}/v1.0/contact/users/me`, {
      method: "GET",
      headers: { "x-acs-dingtalk-access-token": token.accessToken }
    });
    const userId = stringValue(user, "userId", "userid", "user_id", "openId", "openid");
    if (!userId) throw new Error("dingtalk_identity_user_id_missing");
    const unionId = stringValue(user, "unionId", "unionid");
    if (!unionId) throw new Error("dingtalk_identity_union_id_missing");
    const identity: DingTalkIdentity = {
      userId,
      corpId: stringValue(user, "corpId", "corpid") ?? this.config.corpId,
      name: stringValue(user, "name", "nick", "nickname") ?? userId
    };
    this.userTokens.set(identity.userId, { ...token, unionId });
    this.userTokens.set(unionId, { ...token, unionId });
    this.trace("identity.exchanged", { userId: identity.userId, corpId: identity.corpId });
    return identity;
  }

  async sendWorkNotification(input: WorkNotification): Promise<{ taskId: string }> {
    if (!this.config.agentId) throw new Error("dingtalk_agent_id_missing");
    const accessToken = await this.getAppToken();
    const message = JSON.stringify({
      msgtype: "link",
      link: {
        messageUrl: input.url,
        picUrl: "",
        title: input.title,
        text: input.body
      }
    });
    const response = await this.requestJson("work_notification.send", `${this.legacyApiBaseUrl}/topapi/message/corpconversation/asyncsend_v2`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        agent_id: String(this.config.agentId),
        userid_list: input.userId,
        to_all_user: "false",
        msg: message
      })
    });
    assertDingTalkSuccess(response, "work_notification.send");
    const taskId = stringValue(response, "task_id", "taskId");
    if (!taskId) throw new Error("dingtalk_work_notification_task_id_missing");
    this.trace("work_notification.sent", { userId: input.userId, taskId });
    return { taskId };
  }

  async createTodo(input: TodoTask): Promise<{ todoId: string }> {
    const token = this.userTokens.get(input.userId);
    if (!token) throw new Error(`dingtalk_user_token_missing_for_todo:${input.userId}`);
    const response = await this.requestJson("todo.create", `${this.apiBaseUrl}/v1.0/todo/users/me/personalTasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": token.accessToken
      },
      body: JSON.stringify({
        subject: input.subject,
        description: `请在钉钉内查看工资明细\n${input.url}`,
        executorIds: [token.unionId],
        notifyConfigs: { dingNotify: "1" }
      })
    });
    const todoId = stringValue(response, "taskId", "task_id");
    if (!todoId) throw new Error("dingtalk_todo_id_missing");
    this.trace("todo.created", { userId: input.userId, todoId });
    return { todoId };
  }

  private async getUserToken(code: string): Promise<CachedToken> {
    const response = await this.requestJson("identity.token", `${this.apiBaseUrl}/v1.0/oauth2/userAccessToken`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: this.config.clientId, clientSecret: this.config.clientSecret, code, grantType: "authorization_code" })
    });
    const accessToken = stringValue(response, "accessToken", "access_token");
    const expireIn = numberValue(response, "expireIn", "expiresIn", "expires_in") ?? 7200;
    if (!accessToken) throw new Error("dingtalk_user_access_token_missing");
    return { accessToken, expiresAt: Date.now() + Math.max(1, expireIn) * 1000 - TOKEN_SKEW_MS };
  }

  private async getAppToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now()) return this.appToken.accessToken;
    const url = new URL(`${this.legacyApiBaseUrl}/gettoken`);
    url.searchParams.set("appkey", this.config.clientId);
    url.searchParams.set("appsecret", this.config.clientSecret);
    const response = await this.requestJson("app.token", url.toString(), { method: "GET" });
    assertDingTalkSuccess(response, "app.token");
    const accessToken = stringValue(response, "access_token", "accessToken");
    const expireIn = numberValue(response, "expires_in", "expireIn") ?? 7200;
    if (!accessToken) throw new Error("dingtalk_app_access_token_missing");
    this.appToken = { accessToken, expiresAt: Date.now() + Math.max(1, expireIn) * 1000 - TOKEN_SKEW_MS };
    return accessToken;
  }

  private async requestJson(operation: string, url: string, init: RequestInit): Promise<JsonObject> {
    this.trace("request.started", { operation, method: init.method ?? "GET", path: new URL(url).pathname });
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      this.trace("request.failed", { operation, reason: error instanceof Error ? error.message : "network_error" });
      throw new Error(`dingtalk_request_failed:${operation}`);
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      this.trace("request.failed", { operation, status: response.status, reason: "invalid_json" });
      throw new Error(`dingtalk_invalid_response:${operation}`);
    }
    if (!isObject(body)) {
      this.trace("request.failed", { operation, status: response.status, reason: "response_not_object" });
      throw new Error(`dingtalk_invalid_response:${operation}`);
    }
    if (!response.ok) {
      const code = stringValue(body, "code", "errcode", "errorCode") ?? `http_${response.status}`;
      this.trace("request.failed", { operation, status: response.status, code });
      throw new Error(`dingtalk_api_error:${operation}:${code}`);
    }
    this.trace("request.completed", { operation, status: response.status });
    return body;
  }

  private trace(event: string, fields: Record<string, unknown>): void {
    this.config.onEvent?.(event, fields);
  }
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return undefined;
}

function numberValue(value: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim() && Number.isFinite(Number(candidate))) return Number(candidate);
  }
  return undefined;
}

function assertDingTalkSuccess(value: JsonObject, operation: string): void {
  const code = numberValue(value, "errcode", "errorCode") ?? stringValue(value, "errcode", "errorCode");
  if (code !== undefined && String(code) !== "0") {
    const message = stringValue(value, "errmsg", "message", "errorMessage") ?? String(code);
    throw new Error(`dingtalk_api_error:${operation}:${message}`);
  }
}
