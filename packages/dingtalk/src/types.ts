export interface DingTalkIdentity {
  userId: string;
  corpId: string;
  name: string;
}

export interface WorkNotification {
  userId: string;
  title: string;
  body: string;
  url: string;
}

export interface TodoTask {
  userId: string;
  subject: string;
  url: string;
}

export interface DirectoryUser {
  userId: string;
  name: string;
  employeeNo?: string;
  position?: string;
  departmentIds: number[];
}

export interface DingTalkClient {
  exchangeAuthCode(code: string): Promise<DingTalkIdentity>;
  sendWorkNotification(input: WorkNotification): Promise<{ taskId: string }>;
  createTodo(input: TodoTask): Promise<{ todoId: string }>;
  listDirectoryUsers(): Promise<DirectoryUser[]>;
}
