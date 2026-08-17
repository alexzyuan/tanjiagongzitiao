# 薪资中心内部应用

这是一个独立的钉钉企业内部应用原型，按“智能工资条”的信息架构实现以下模块：工资条管理、发薪存证、报表中心、权限管理和系统设置。年终奖临界优化、年度汇总、社保、工资计算等扩展模块不在当前范围内。

## 本地运行

```bash
pnpm install --ignore-scripts
pnpm dev
```

管理端地址：`http://localhost:5173/`

本地默认使用 `DINGTALK_MODE=mock`，管理员为 `dev-admin`。员工页面可用 `/employee/salary-slips/<batchId>?as=<userId>` 模拟钉钉身份。正式接入时设置 `DINGTALK_MODE=http`、`DINGTALK_CLIENT_ID`（AppKey）、`DINGTALK_CLIENT_SECRET`（AppSecret）、`DINGTALK_CORP_ID` 和数字 `DINGTALK_AGENT_ID`，并使用 HTTPS 的 `APP_BASE_URL`。网页必须在钉钉客户端内打开，前端通过官方 JSAPI `dd.getAuthCode` 登录；HTTP 模式会关闭开发登录接口，缺少 JSAPI、AgentId 或接口权限时直接返回明确错误。

当前本地演示使用内存仓储，重启 API 会清空工资数据；临时 HTTPS 隧道也只适合联调。上线前需要稳定 HTTPS 域名、持久化数据库和独立的密钥管理。

## 权限规则

- 企业管理员默认是主管理员，可管理所有工资表、历史数据、存证、报表、权限和设置。
- 子管理员和工资表管理员必须由主管理员手动添加；工资表管理员只可管理被分配的工资表。
- 员工只能通过当前钉钉身份读取自己的最近 12 个月工资条。
- 12 个月以前的批次进入加密归档，只有主管理员可访问。

## 质量门禁

```bash
pnpm -r test
pnpm -r typecheck
pnpm --filter @salary/web build
```

工资字段在内存演示仓储和 Prisma schema 中都按 AES-256-GCM 设计保存；业务错误会返回明确错误码并记录请求 ID，不用兜底逻辑吞掉异常。
