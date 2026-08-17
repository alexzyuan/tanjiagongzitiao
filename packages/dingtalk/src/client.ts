import type { DingTalkClient, DingTalkIdentity, TodoTask, WorkNotification } from "./types.js";

interface HttpDingTalkConfig { clientId: string; clientSecret: string; }

export class HttpDingTalkClient implements DingTalkClient {
  constructor(private readonly config: HttpDingTalkConfig) {}

  async exchangeAuthCode(code: string): Promise<DingTalkIdentity> {
    if (!code) throw new Error("dingtalk_auth_code_missing");
    throw new Error("dingtalk_http_identity_exchange_requires_official_adapter");
  }

  async sendWorkNotification(_input: WorkNotification): Promise<{ taskId: string }> {
    if (!this.config.clientId || !this.config.clientSecret) throw new Error("dingtalk_client_credentials_missing");
    throw new Error("dingtalk_http_work_notification_requires_official_adapter");
  }

  async createTodo(_input: TodoTask): Promise<{ todoId: string }> {
    if (!this.config.clientId || !this.config.clientSecret) throw new Error("dingtalk_client_credentials_missing");
    throw new Error("dingtalk_http_todo_requires_official_adapter");
  }
}
