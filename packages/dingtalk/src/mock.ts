import { randomUUID } from "node:crypto";
import type {
  DingTalkClient,
  DingTalkIdentity,
  DirectoryUser,
  TodoTask,
  WorkNotification,
} from "./types.js";

export class MockDingTalkClient implements DingTalkClient {
  readonly notifications: WorkNotification[] = [];
  readonly todos: TodoTask[] = [];

  async exchangeAuthCode(code: string): Promise<DingTalkIdentity> {
    if (code !== "mock-code") throw new Error("mock_auth_code_invalid");
    return { userId: "dev-admin", corpId: "dev-corp", name: "开发管理员" };
  }

  async sendWorkNotification(
    input: WorkNotification,
  ): Promise<{ taskId: string }> {
    this.notifications.push(input);
    return { taskId: `mock-task-${randomUUID()}` };
  }

  async createTodo(input: TodoTask): Promise<{ todoId: string }> {
    this.todos.push(input);
    return { todoId: `mock-todo-${randomUUID()}` };
  }

  async listDirectoryUsers(): Promise<DirectoryUser[]> {
    return [
      {
        userId: "hr-user",
        name: "人事管理员",
        employeeNo: "HR001",
        position: "人力资源",
        departmentIds: [2],
      },
      {
        userId: "employee-a",
        name: "员工A",
        employeeNo: "A001",
        position: "财务",
        departmentIds: [1],
      },
      {
        userId: "employee-b",
        name: "员工B",
        employeeNo: "B001",
        position: "运营",
        departmentIds: [1],
      },
    ];
  }

  async getDirectoryUser(userId: string): Promise<DirectoryUser | undefined> {
    return (await this.listDirectoryUsers()).find(
      (user) => user.userId === userId,
    );
  }
}
