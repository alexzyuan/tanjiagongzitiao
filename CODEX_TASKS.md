# 钉钉工资条内部应用：剩余整改与持续轻量架构任务（Codex 执行版）

> **仓库：** `alexzyuan/tanjiagongzitiao`
>
> **基线分支：** `main`
>
> **当前基线提交：** `c4dda55e8f9c4a8adab50ede3dc67bd6653ff019`
>
> **基线提交说明：** `docs: align github main phase guidance`
>
> **状态：** 原 Phase G0 已完成并合并到 `main`。本文件从后续代码整改与长期架构约束开始。
>
> **用途：** 本文件同时解决两类问题：
>
> 1. 当前代码仍存在的正确性、安全最小读取和结构问题；
> 2. 以后 Codex/开发者继续加功能时，防止项目重新膨胀、重复、引入不必要基础设施。
>
> **重要：本文件不是一次性全部授权。**
> Codex 每次只能执行用户明确指定的一个 Phase。
> 完成当前 Phase 后必须停止、报告结果并等待下一次授权。

---

# 0. 当前项目判断

当前应用已经具备较完整的安全基础，不需要重写。

已经存在并应保持的能力：

- 钉钉企业内部免登身份；
- HR 三步 Excel 导入；
- 企业通讯录匹配；
- SQLite / WAL；
- AES-256-GCM 工资字段加密；
- 员工服务端身份隔离；
- 服务端 `visibleFields` 白名单过滤；
- 历史 `visibleFields: []` 的兼容读取；
- 新配置禁止显式空 `visibleFields`；
- `netAmountField` 必须属于可见字段；
- 单员工发送；
- 批量发送；
- failed-only resend；
- 单员工同实例 in-flight 防重复；
- 本地撤回访问；
- 审计；
- 存证 fingerprint；
- 8 小时 Session；
- production HTTPS 和 SQLite 绝对路径限制；
- 12 个月员工访问限制；
- archive worker；
- batch summary；
- Prisma / PostgreSQL / Redis / BullMQ 等遗留基础设施已经清理；
- TanStack 等未使用前端依赖已经清理。

原 Phase G0 已完成：

- 根 `AGENTS.md` 已增加安全边界；
- 已增加技术栈边界；
- 已增加 Git / 验证纪律；
- `HANDOFF.md` 已明确互动卡片不是当前默认任务；
- 根 `CODEX_TASKS.md` 已成为当前 Phase 清单。

因此：

> **后续任务不再以“大安全补洞”为主，而是进入“正确性收口 + 数据最小读取 + 结构拆分 + 架构防回退”。**

---

# 1. 最终架构目标

本项目长期保持为一个简单的企业内部应用。

目标运行结构：

```text
Browser / DingTalk WebView
        │
        ▼
   React Web
        │ HTTP
        ▼
 Fastify API
   │       │
   │       └──────── DingTalk API
   │
   ▼
 SQLite
   ▲
   │
one-shot archive worker
(cron/systemd 外部调度)
```

不要演化成：

```text
Web
 ↓
API Gateway
 ↓
multiple microservices
 ↓
Redis / MQ / ORM / second DB
 ↓
scheduler service
 ↓
extra cache layer
```

除非未来出现明确且经过验证的业务需求，并由用户单独授权。

---

# 2. 长期依赖方向

以后新增代码必须遵循下面的依赖方向。

```text
packages/domain
      ▲
      │
packages/db

packages/dingtalk

packages/domain ───────┐
packages/db ───────────┼──► apps/api
packages/dingtalk ─────┘

packages/db ─────────────► apps/worker

HTTP contract ───────────► apps/web
```

## 2.1 `packages/domain`

职责：

- 纯领域类型；
- 状态机；
- 无 IO 的业务规则；
- 小型纯 helper。

允许：

```text
TypeScript 标准能力
```

禁止依赖：

```text
apps/*
@salary/db
@salary/dingtalk
Fastify
React
better-sqlite3
HTTP client
filesystem
```

原则：

> domain 必须可以在不知道数据库、Fastify、React、钉钉存在的情况下被理解和测试。

## 2.2 `packages/db`

职责：

- `SalaryStore` contract；
- SQLite 实现；
- Memory store；
- encryption；
- migration；
- 数据映射。

允许依赖：

```text
@salary/domain
better-sqlite3
Node crypto/fs/path 等必要标准库
```

禁止：

```text
apps/*
Fastify
React
DingTalk API client
业务 UI 类型
```

DB 不负责：

- HTTP status；
- 页面权限；
- 钉钉消息内容；
- UI copy。

## 2.3 `packages/dingtalk`

职责：

- 钉钉认证；
- 通讯录；
- 工作通知；
- 钉钉 API transport；
- mock client。

禁止：

```text
apps/*
@salary/db
SQLite
Fastify route
React
工资业务状态机
```

DingTalk adapter 不决定：

```text
谁有工资访问权限
谁应该被重发
什么 batch 可撤回
```

这些属于应用/领域层。

## 2.4 `apps/api`

职责：

- HTTP routes；
- Session；
- Authorization；
- salary orchestration；
- report；
- audit orchestration；
- settings；
- 调用 DB 和 DingTalk adapter。

允许依赖：

```text
@salary/domain
@salary/db
@salary/dingtalk
Fastify
```

禁止：

```text
apps/web/src/*
apps/worker/src/*
```

API 不能因为“复用方便”直接 import 前端源码。

## 2.5 `apps/web`

职责：

- React UI；
- 用户交互；
- HTTP API client；
- 前端格式化；
- 页面级状态。

原则：

```text
Web 只相信 HTTP 响应，不直接依赖数据库实现。
```

禁止直接依赖：

```text
@salary/db
better-sqlite3
apps/api/src/*
packages/dingtalk
Node-only 模块
```

如果某类型需要前后端共享：

优先：

1. 放入 `@salary/domain`，前提是它真的是领域类型；
2. 或在 web 保留 HTTP DTO 类型；
3. 不直接 import API 内部 service 类型。

## 2.6 `apps/worker`

职责保持极小：

```text
读取配置
初始化 SQLite store
执行一次 archive
关闭 store
退出
```

允许依赖：

```text
@salary/db
必要时 @salary/domain
```

禁止逐步演化成：

- 第二套 API；
- DingTalk 发送 worker；
- Redis consumer；
- 常驻 scheduler；
- 通用 job platform。

调度继续交给：

```text
cron
systemd timer
外部平台调度
```

---

# 3. 轻量化原则

## 3.1 新依赖原则

增加 runtime dependency 前必须在 Phase 报告中回答：

```text
1. 当前代码或 Node 标准库为什么不能解决？
2. 该依赖解决的真实问题是什么？
3. 它是否进入 production runtime？
4. 是否可以替换已有依赖，而不是叠加？
5. 删除它的成本是什么？
```

未经用户明确授权，以下依赖类别禁止重新出现：

```text
Prisma
TypeORM
Sequelize
Drizzle（当前无需求）
Redis
ioredis
BullMQ
RabbitMQ client
Kafka client
Redux
React Query
TanStack Router
React Router（当前路由规模不需要）
Tailwind
styled-components
CSS Modules
```

这不是永久否定这些技术，而是：

> 当前应用没有足够复杂度证明它们值得增加。

## 3.2 新基础设施原则

增加以下任意内容都视为**架构变化**，必须用户单独授权：

- 第二数据库；
- Redis；
- 消息队列；
- 新常驻服务；
- API Gateway；
- scheduler service；
- microservice；
- 分布式锁；
- 外部 cache；
- object storage 作为工资主存储。

Codex 不得因为：

```text
“更标准”
“更企业级”
“更可扩展”
```

自行引入。

## 3.3 数据最小读取原则

这是安全和性能共同约束。

```text
只需要 batch metadata
=> 不读取 salary_items

只判断权限
=> 不解密工资

员工 A 查询
=> 不解密员工 B 工资

sub-admin 查询报表
=> 不读取未授权 batch 工资

只有真正展示/计算工资
=> 才读取并解密相应授权数据
```

## 3.4 抽象原则

不要按“代码长得像”抽象。

只有稳定业务概念才抽：

适合：

```text
employeeVisibleItem
employeeAccessibleSlip
uniqueDeliveredEmployeeCount
SalaryBatchSummary
validateDisplaySettings
```

不适合：

```text
CommonManager
BaseService
GenericRepository
CommonUtils
HelperFactory
AbstractProvider
```

规则：

> 复用业务语义，而不是复用偶然相似的几行代码。

---

# 4. 文件规模守门

以下是 **Review Trigger**，不是机械 CI hard fail。

达到阈值：

> 必须检查职责，但不要求为了数字强拆。

## 4.1 Web

```text
React page / feature > 400 行
=> 检查是否包含多个独立业务功能

App.tsx > 500 行
=> 默认认为顶层职责过多，除非有明确理由

单个通用 component > 250 行
=> 检查是否包含业务状态
```

## 4.2 API

```text
service > 600 行
=> 必须做职责审查

route file > 400 行
=> 检查是否包含多个资源域

单个函数 > 100 行
=> 检查是否混合：
   validation
   IO
   state transition
   mapping
   audit
```

函数行数暂不作为自动 CI 规则，避免为了满足指标机械拆 helper。

## 4.3 DB

```text
store implementation > 700 行
=> 检查 persistence / mapping / migration 是否可自然分离

store interface + implementation 混合过大
=> 可以拆 interface 与 memory implementation
```

但不要建立 repository 层。

## 4.4 CSS

```text
单 CSS > 650 行
=> 检查是否混入多个页面职责

同一普通 selector 跨文件重复
=> 必须确认是否有意 cascade
```

media / print / responsive override 可以存在。

---

# 5. 每个 Phase 的固定执行纪律

执行任何 Phase 前：

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

确认基于最新 `main` 创建工作分支。

如果当前任务会修改多个文件或做结构调整：

```text
codex/<phase-name>
```

不要直接在 main 做大规模修改。

## 行为修改

必须：

1. 读实现；
2. 读已有测试；
3. 写失败测试；
4. 运行确认 FAIL；
5. 最小实现；
6. 运行确认 PASS。

## 机械结构移动

不要求人为制造失败测试，但必须：

1. 移动前相关测试 PASS；
2. 每次只移动一个清晰单元；
3. 移动后测试 PASS；
4. 不同时改业务行为。

## Phase 完成门禁

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm architecture:check   # 从 Phase G3 建立后开始要求
git diff --check
```

未实际成功不得报告“通过”。

---

# Phase G1 — 剩余业务正确性收口

**优先级：P1**

**目标：** 解决当前已经确认但尚未收口的几个小型正确性问题，为后续结构重构提供稳定基线。

---

## G1.1 单员工发送 delivered 统计改为唯一员工

### 当前问题

`sendItem()` 成功后当前按：

```ts
listDeliveries(batchId)
  .filter(status === "delivered")
  .length
```

判断是否全部员工已经 delivered。

这统计的是：

```text
delivery rows
```

而不是：

```text
unique delivered employees
```

如果历史数据中同一个员工存在多条 delivered 记录，可能提前满足：

```text
deliveredCount === total
```

### 目标

增加纯 helper，例如：

```ts
function uniqueDeliveredEmployeeCount(
  deliveries: DeliveryRecord[],
): number
```

语义：

```text
status === delivered
按 employeeUserId 去重
```

并用于 `sendItem()` 最终 batch 状态判断。

不要删除历史 delivery rows。

### 测试

`salary-delivery.test.ts` 增加：

```text
batch = A, B 两人

历史：
A delivered
A delivered（重复历史）
B 尚未 delivered

=> 不能判 batch sent

B delivered 后：
unique delivered = 2
batch sent
sent = 2
total = 2
```

继续保证：

```text
sent <= total
```

---

## G1.2 补齐业务冲突 HTTP 409

检查当前 `server.ts` 对以下错误：

```text
salary_item_not_sendable:*
salary_batch_not_sendable:*
invalid_salary_batch_transition:*
```

如果当前仍落到 500：

改为稳定 409。

注意：

员工访问场景使用：

```text
salary_item_withdrawn -> 404
```

的隐藏资源语义不得被破坏。

优先使用小型 helper：

```ts
function businessErrorStatus(message: string): number | undefined
```

不要引入自定义 Error class 大体系，除非当前代码已自然需要。

### 测试

覆盖：

- 已发送 item 再单发；
- sending/archived item 不可发送；
- invalid transition；
- employee withdrawn 仍 404；
- 未知异常仍 500。

---

## G1.3 confirmation disabled 员工文案一致

当前按钮已经受 `confirmationEnabled` 控制。

底部说明也必须一致。

### true

```text
查看和确认时间将生成存证记录
```

### false

```text
查看时间将生成存证记录
```

只改文案逻辑，不改 evidence 行为。

---

## G1.4 补 display settings 边界测试

已有：

```text
explicit visibleFields: [] -> 400
```

补：

1. `netAmountField` 不在 visibleFields -> 400；
2. template visibleFields [] -> 400；
3. template netAmountField hidden -> 400；
4. 合法 template -> 200；
5. 未显式传 displaySettings 的 default/历史兼容行为不变。

---

## G1.5 Web 关键行为测试

新增独立：

```text
apps/web/src/pages/EmployeeSalary.test.tsx
```

优先不要继续把所有测试堆到 `App.test.tsx`。

至少：

- confirmation false 不显示按钮；
- confirmation false 文案不出现“确认时间”；
- confirmation true 显示按钮；
- confirmation true 显示确认存证文案；
- `SalarySlipPreview` visibleFields [] 展示全部 fields；
- 非空 visibleFields 只展示白名单。

---

## G1 验证

```bash
pnpm --filter @salary/api test -- salary-delivery.test.ts salary-import.test.ts employee-access.test.ts
pnpm --filter @salary/web test

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

### G1 验收标准

- delivery 统计按员工唯一值；
- `sent <= total`；
- 常见管理员业务冲突不返回 500；
- confirmation UI 文案一致；
- display settings 边界有回归测试；
- 不新增依赖。

**完成后停止。**

---

# Phase G2 — 敏感工资数据最小读取

**优先级：P1 / 架构核心**

**目标：**

> 只有真正需要工资明细的路径才解密工资。

这是本轮最重要的后端架构整改。

---

## G2.1 当前已正确部分

保持：

```text
AuthorizationService.accessFor()
=> listBatchSummaries()

SalaryService.list()
=> listBatchSummaries()
```

不要回退。

---

## G2.2 员工列表移除 `listBatches()`

### 当前问题

当前员工列表类似：

```ts
store.listBatches()
  .flatMap(...)
```

而 SQLite `listBatches()` 会构造完整 batch 和 items。

目标：

```text
员工 A 打开列表
=> 只读取 batch metadata
=> 只查询员工 A 自己的 item
=> 不解密同批员工 B/C
```

### 推荐方案 A：最简单

```ts
listBatchSummaries()

for each summary:
  getEmployeeItem(summary.id, access.userId)
```

对于当前小型内部应用，优先简单正确。

### 推荐方案 B：如果 SQL 更自然

Store 增加：

```ts
listEmployeeBatchSummaries(
  employeeUserId: string
): SalaryBatchSummary[]
```

SQLite 使用 salary_items 只做：

```text
batch_id / employee_user_id existence filter
```

不要读取 encrypted fields。

然后只对匹配 batch：

```ts
getEmployeeItem(batchId, employeeUserId)
```

### 选择原则

选更少代码、更容易测试的方案。

不要增加 query builder / repository framework。

---

## G2.3 employee access helper 依赖 summary 而非 full batch

当前 `employeeAccessibleSlip()` 如果仅为了：

- state；
- payrollMonth；
- displaySettings；

却拿完整 batch，应调整。

目标 shape：

```ts
{
  batch: SalaryBatchSummary,
  item: StoredItem
}
```

只有管理员详情需要：

```ts
StoredBatch
```

员工：

```text
list
detail
view
confirm
fingerprint
```

都不得因为 batch metadata 需求顺带解密所有 items。

---

## G2.4 ReportService 先授权再解密

### 当前问题

当前流程：

```text
listBatches()
↓
解密全部
↓
filter canManageBatch()
```

对 sub-admin / batch-admin 不符合最小读取。

### 新流程

```text
listBatchSummaries()
↓
filter state
↓
filter access
↓
filter month
↓
得到 allowed IDs
↓
仅 allowed IDs getBatch()
↓
计算 salaryTotals
```

返回的：

```text
report.batches
```

继续不能包含：

```text
items
```

---

## G2.5 Audit / evidence / delivery 也按 allowed batch 过滤

ReportService 当前可以一次读取所有：

```text
deliveries
evidence
```

它们不包含工资明细，但也属于业务记录。

如果 store 当前没有按 batch list 查询接口，不要求本 Phase 建复杂 SQL。

至少：

```text
在内存只统计 allowed batch IDs
```

未来数据量明显增大时再增加窄查询。

本 Phase 的 P1 是：

```text
工资字段解密边界
```

不要扩大成全数据库性能重写。

---

## G2.6 Store contract 只增加窄接口

允许新增：

```ts
getBatchSummary(id)
listEmployeeBatchSummaries(userId)
```

如果实际实现需要。

禁止新增：

```text
SalaryRepository
EmployeeRepository
ReportRepository
QueryBus
DataAccessLayer
```

---

## G2.7 测试：用调用边界证明安全

### Employee

使用 fake/spy store：

```text
listBatches() 直接 throw
```

员工 list 仍必须成功。

并证明：

- A 只能获取 A；
- hidden fields；
- withdrawn；
- archived；
- 12 months；

全部不回归。

### Report

fake store：

```text
getBatch(unauthorizedBatchId)
=> throw "test_unauthorized_full_batch_read"
```

sub-admin summary 应正常成功。

这证明：

```text
未授权 batch 根本没有进入工资解密路径
```

### SQLite

测试：

```text
listBatchSummaries()
```

不包含 items。

如果容易 spy：

```text
不调用 decryptSalaryPayload
```

否则通过结果/SQL边界测试即可，不为测试改坏生产代码。

---

## G2 验证

```bash
pnpm --filter @salary/db test
pnpm --filter @salary/api test -- employee-access.test.ts authorization-boundary.test.ts
pnpm --filter @salary/api test

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

### G2 验收标准

- 权限判断不解密工资；
- admin batch list 不解密工资；
- employee list 不解密其他员工工资；
- sub-admin report 不解密未授权工资；
- admin detail 完整查看仍可用；
- 不增加复杂数据访问层。

**完成后停止。**

---

# Phase G3 — 建立可执行的 Architecture Guardrails

**优先级：P1/P2**

**目标：**

把“轻量架构”从 Markdown 建议变成可自动检查的规则。

新增：

```text
scripts/check-architecture.mjs
```

根 package script：

```json
"architecture:check": "node scripts/check-architecture.mjs"
```

不增加 npm dependency。

---

## G3.1 Hard Fail：禁止依赖

脚本扫描 workspace `package.json`。

以下出现即失败：

```text
prisma
@prisma/client
typeorm
sequelize
redis
ioredis
bullmq
amqplib
kafkajs
redux
@reduxjs/toolkit
@tanstack/react-query
@tanstack/react-router
react-router
react-router-dom
tailwindcss
styled-components
```

如果未来用户明确授权某项：

必须同时修改：

```text
AGENTS.md
architecture script
architecture decision
```

不能偷偷删检查。

---

## G3.2 Hard Fail：依赖方向

使用 Node fs 递归扫描：

```text
.ts
.tsx
.mts
.mjs
```

跳过：

```text
dist
node_modules
coverage
```

### Rule A

`packages/domain/**` 禁止 import：

```text
@salary/db
@salary/dingtalk
apps/
fastify
react
better-sqlite3
```

### Rule B

`packages/db/**` 禁止 import：

```text
apps/
@salary/dingtalk
fastify
react
```

### Rule C

`packages/dingtalk/**` 禁止 import：

```text
apps/
@salary/db
fastify route internals
react
```

### Rule D

`apps/web/**` 禁止 import：

```text
@salary/db
@salary/dingtalk
apps/api
better-sqlite3
node:fs
node:path
```

如 Vite config 合理使用 Node path，应：

```text
只对白名单 config 文件豁免
```

不要为了规则破坏构建配置。

### Rule E

`apps/worker/**` 禁止 import：

```text
@salary/dingtalk
fastify
react
apps/api
apps/web
```

### Rule F

`packages/**` 禁止 import：

```text
apps/*
```

---

## G3.3 Hard Fail：禁止新增 infra manifests

扫描：

```text
docker-compose.yml
compose.yaml
```

如果出现：

```text
postgres
mysql
redis
rabbitmq
kafka
```

失败。

当前如果没有 compose，则不需要创建文件。

---

## G3.4 Warning：文件规模

脚本输出 warning，但 exit code 保持 0：

### Web

```text
App.tsx > 500
*.tsx page/feature > 400
```

### API

```text
*service.ts > 600
*routes.ts > 400
```

### DB

```text
store implementation > 700
```

### CSS

```text
*.css > 650
```

格式：

```text
ARCH-WARN file_size apps/web/src/App.tsx 2383 > 500
```

这些 warning 是后续 Phase 的工作提示。

不要：

```text
为了让 architecture:check 变绿而把 warning 当 failure
```

---

## G3.5 Warning：跨 CSS 文件重复 selector

实现轻量检查。

只扫描普通 selector。

可以忽略：

```text
@media
@print
@keyframes
:root
```

第一版只要求能发现明显：

```text
.directory-result
```

等跨文件重复。

输出：

```text
ARCH-WARN duplicate_selector .directory-result
  components.css
  import.css
```

不要求第一版完整解析所有 CSS 语法。

如果简单 parser 会产生太多 false positive：

保留 selector check 为单独脚本 warning，并写清 limitation。

不要增加 postcss 依赖。

---

## G3.6 Architecture tests

为脚本增加 fixture 测试。

推荐：

```text
scripts/check-architecture.test.mjs
```

或把逻辑拆成：

```text
scripts/architecture-rules.mjs
scripts/check-architecture.mjs
```

测试至少：

- banned dependency 被发现；
- packages -> apps import 被发现；
- domain -> db import 被发现；
- web -> db import 被发现；
- file-size warning 不导致 hard fail；
- 合法结构通过。

可以使用 Node 内置：

```text
node:test
assert
fs.mkdtemp
```

不要为了脚本测试新增 Vitest workspace 配置。

---

## G3.7 Root script

`package.json`：

```json
{
  "scripts": {
    "architecture:check": "node scripts/check-architecture.mjs"
  }
}
```

不要顺带增加 lint framework。

---

## G3.8 将规则补入 AGENTS.md

增加短小“架构依赖方向”章节。

不要把整个本文件复制进 AGENTS。

AGENTS 只保留长期 contract：

```text
domain/db/dingtalk/api/web/worker 依赖方向
新依赖原则
数据最小读取
架构 hard fail
规模是 warning
```

---

## G3 验证

```bash
pnpm architecture:check
node --test scripts/check-architecture.test.mjs

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

### G3 验收标准

- 关键架构边界可自动检测；
- banned infra 回归会失败；
- 文件规模只 warning；
- 不新增第三方依赖；
- 不为 architecture script 重写业务代码。

**完成后停止。**

---

# Phase G4 — 前端行为测试与功能结构拆分

**优先级：P2**

当前 `apps/web/src/App.tsx` 仍是最大结构债务。

目标：

```text
App.tsx = 顶层 composition
page = 页面
feature = 工资业务块
component = 真正复用 UI
```

不是：

```text
把一个大文件机械切成很多 forwarding wrapper
```

---

## G4.1 先补管理端行为 smoke tests

拆分前必须保证关键行为有测试。

新增按页面分组测试：

```text
pages/SalaryManagement.test.tsx
pages/EvidenceCenter.test.tsx
pages/ReportCenter.test.tsx
pages/PermissionCenter.test.tsx
pages/SettingsCenter.test.tsx
```

不一定每个必须单独文件；如果合理也可按模块合并。

必须覆盖：

### Salary

- GET batch summaries；
- 自动 GET active batch detail；
- 打开 ImportWizard；
- 单员工发送按钮；
- withdrawn/failed 基础状态渲染。

### Evidence

- 基础请求；
- empty；
- 有记录时渲染。

### Report

- 基础请求；
- 月份筛选；
- totals 显示。

### Permission

- sub-admin list；
- directory picker 入口；
- 不依赖硬编码管理员 UI。

### Settings

- 当前 settings 加载；
- 真实可配置项渲染。

不要做大 snapshot。

---

## G4.2 目标文件结构

推荐：

```text
apps/web/src/
├── App.tsx
├── api.ts
├── format.ts
├── icons.tsx
│
├── pages/
│   ├── EmployeeSalary.tsx
│   ├── SalaryManagement.tsx
│   ├── EvidenceCenter.tsx
│   ├── ReportCenter.tsx
│   ├── PermissionCenter.tsx
│   └── SettingsCenter.tsx
│
├── features/
│   └── salary/
│       ├── ImportWizard.tsx
│       ├── ManualPanel.tsx
│       ├── BatchDetail.tsx
│       ├── EmployeeRow.tsx
│       └── SalarySlipPreview.tsx
│
└── components/
    ├── Modal.tsx
    ├── Field.tsx
    ├── Toggle.tsx
    ├── Status.tsx
    ├── Metric.tsx
    ├── Loading.tsx
    └── EmptyState.tsx
```

如果某组件只有 15 行且只被一个页面使用：

留在页面文件。

不要为了目录树创建空文件。

---

## G4.3 页面与 feature 边界

### App.tsx

只保留：

- pathname 顶层入口；
- session identity；
- AdminApp shell；
- module nav；
- refreshKey；
- 页面 composition。

### SalaryManagement.tsx

保留：

- batch list；
- active batch；
- detail loading；
- 页面级筛选；
- salary actions orchestration。

不要继续包含完整 ImportWizard 实现。

### ImportWizard.tsx

保留：

- 三步 UI；
- preview；
- match；
- display settings；
- template apply/save；
- commit。

### BatchDetail

保留：

- employee rows；
- selection；
- status display；
- row action UI。

---

## G4.4 每移动一个单元都测试

顺序建议：

```text
EvidenceCenter
ReportCenter
SettingsCenter
PermissionCenter
BatchDetail
ManualPanel
ImportWizard
shared UI
SalaryManagement
```

每步：

```bash
pnpm --filter @salary/web test
pnpm --filter @salary/web typecheck
```

不要一次移动 2000 行后统一修。

---

## G4.5 不建立新的全局状态层

禁止：

```text
Redux
Context 作为通用 store
React Query
router state framework
event bus
```

现有：

```text
props
local state
small callbacks
```

足够时继续使用。

---

## G4.6 架构 warning 目标

完成后：

```text
App.tsx 不应再触发 >500 warning
```

如果仍略大，但只包含顶层 composition：

可以接受。

关键不是行数本身，而是：

```text
不再实现大型业务 feature
```

每个拆出页面原则上 < 400 行。

如果某页面 > 400：

检查自然 feature 边界，不强拆 presentation helper。

---

## G4 验证

```bash
pnpm --filter @salary/web test
pnpm --filter @salary/web typecheck
pnpm --filter @salary/web build
pnpm architecture:check

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

### G4 验收标准

- App.tsx 成为顶层组合文件；
- page/feature 边界明确；
- 原行为不变；
- 测试显著强于当前三个基础用例；
- 没有新状态/路由框架；
- 没有 UI redesign。

**完成后停止。**

---

# Phase G5 — CSS 职责与重复规则收口

**优先级：P2**

当前 CSS 文件拆分方向正确：

```text
base
components
employee
import
salary
```

本 Phase 不重新设计视觉。

---

## G5.1 CSS 职责规则

### base.css

只保留：

- variables；
- reset；
- typography；
- body；
- app shell；
- sidebar/topbar；
- base buttons/inputs；
- 通用 layout primitive。

### components.css

保留真正复用：

- modal；
- drawer；
- status；
- metric；
- empty/loading；
- directory generic picker（如果多处复用）。

### salary.css

工资管理页面。

### import.css

ImportWizard 专属。

### employee.css

员工工资条。

---

## G5.2 处理重复 selector

以 G3 architecture warning 为输入。

已知优先检查：

```text
.directory-result
.directory-search
.modal-backdrop
setting-row
```

规则：

### 同一组件

只保留一处。

### 不同页面只是 class 撞名

改成更具体的业务 class：

```text
.import-directory-result
.permission-directory-result
```

不要继续依赖：

```text
styles.css import order
```

隐式覆盖。

---

## G5.3 保留 cascade 最终视觉

合并规则前必须确定：

```text
当前最终生效值
```

迁移后保持。

不改变：

- colors；
- spacing；
- breakpoint；
- mobile；
- print；
- employee layout；
- modal overlay；
- import wizard layout。

---

## G5.4 CSS architecture warning 目标

完成后：

```text
明显跨文件 duplicate selector warning 清零
```

对于合理：

```text
media query
print
state modifier
```

允许加入明确 ignore list。

ignore list 必须：

```text
selector + reason
```

不能：

```text
ignore all duplicates
```

---

## G5 验证

```bash
pnpm --filter @salary/web test
pnpm --filter @salary/web typecheck
pnpm --filter @salary/web build
pnpm architecture:check

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

如果有浏览器环境，人工检查：

- SalaryManagement；
- ImportWizard；
- Permission；
- Report；
- Modal；
- EmployeeSalary；
- mobile；
- print。

### G5 验收标准

- CSS 职责清晰；
- 不依赖跨文件偶然覆盖；
- architecture duplicate warning 明显收敛；
- UI 不 redesign；
- 不引入 CSS framework。

**完成后停止。**

---

# Phase G6 — Backend 轻量职责拆分

**优先级：P2 / 条件执行**

执行前先看：

```bash
pnpm architecture:check
wc -l apps/api/src/modules/salary/service.ts
wc -l packages/db/src/store.ts
wc -l packages/db/src/sqlite-store.ts
```

只拆自然边界。

---

# G6-A SalaryService

## 执行条件

完成 G1/G2 后，如果仍：

```text
service.ts > 600
```

且明确同时承担：

```text
import
delivery
employee access
admin/template
```

则拆。

否则：

```text
报告当前不拆更合理
```

---

## 推荐结构

```text
salary/
├── routes.ts
├── service.ts
├── import.ts
├── delivery.ts
└── employee.ts
```

最多先到这里。

---

## delivery.ts

职责：

- batch delivery target；
- send；
- sendItem；
- resend；
- withdraw；
- in-flight；
- unique delivered count；
- delivery status mapping。

不要直接知道 HTTP reply。

---

## employee.ts

职责：

- employeeAccessibleSlip；
- employeeVisibleItem；
- employeeBatchSummary；
- list/read/view/confirm；
- 12-month access；
- fingerprint input helper。

---

## service.ts

保留：

- composition；
- create draft；
- templates；
- admin assignment；
- directory orchestration；
- 对外 facade（如 route 已依赖）。

---

## 拆分纪律

第一轮只移动代码。

禁止同时：

- 改 error code；
- 改 SQL；
- 改 DTO；
- 改 notification；
- 改 access semantics。

---

# G6-B Store 文件职责

当前 `packages/db/src/store.ts` 同时包含：

```text
interface/types
MemorySalaryStore
```

如果在 G2 增加窄接口后明显继续膨胀，可以机械拆：

```text
store.ts
memory-store.ts
```

### store.ts

只保留：

- types；
- SalaryStore interface。

### memory-store.ts

MemorySalaryStore。

`index.ts` 继续稳定 export。

不要创建：

```text
repository.ts
base-store.ts
abstract-store.ts
```

如果 `store.ts` 仍可读，允许不拆。

---

## G6 测试

移动 employee：

```bash
pnpm --filter @salary/api test -- employee-access.test.ts authorization-boundary.test.ts
```

移动 delivery：

```bash
pnpm --filter @salary/api test -- salary-delivery.test.ts
```

DB split：

```bash
pnpm --filter @salary/db test
```

最终：

```bash
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

### G6 验收标准

- 拆分后理解成本下降；
- 文件边界是业务职责，不是理论层次；
- routes/API contract 不变；
- Store contract 不多一层；
- 如果不拆，必须给出基于职责的理由。

**完成后停止。**

---

# Phase G7 — 运行时轻量性与依赖卫生

**优先级：P2**

目标不是做性能工程，而是确认当前运行结构真的保持轻。

---

## G7.1 workspace dependency audit

检查每个：

```text
package.json
```

输出表：

```text
package
runtime dependency
实际源码引用
作用
```

任何 runtime dependency 无源码引用：

删除。

不要扫描 devDependencies 后就机械删测试工具。

---

## G7.2 root tooling audit

当前 root dev tools：

```text
Playwright
TypeScript
Prettier
Node types
```

确认：

- Playwright 是否有实际 e2e 配置/计划；
- 如果 `test:e2e` 长期无测试且完全未使用，不要在本 Phase擅自删除；
- 报告即可，除非用户明确允许清理。

原因：

```text
dev dependency 不影响生产 runtime
```

不要为了依赖数好看破坏未来 e2e 入口。

---

## G7.3 worker 边界

确认 worker：

- 不常驻；
- 没有 Redis；
- 没有 DingTalk；
- 没有 scheduler loop；
- 执行一次归档后 close/exit。

增加/保留测试。

---

## G7.4 API startup

检查：

- 不启动多余 timer；
- 不初始化 unused client；
- 不加载全量工资到内存作为 cache；
- 不在 startup 解密工资。

发现问题才改。

不要加入 cache。

---

## G7.5 Web bundle

运行正常 Vite build。

记录：

```text
dist assets size
```

只作为基线。

如果没有明显异常，不做 premature optimization。

不要：

- 为了 bundle 加复杂 code splitting；
- 换 React；
- 引入 bundler plugin。

只有单个 bundle 出现明确不必要大依赖时才处理。

---

## G7.6 Architecture contract 增加 dependency review 规则

AGENTS 保持一句：

> 新 runtime dependency 必须说明必要性；能用现有依赖/标准库解决时，不新增依赖。

不用创建 ADR 系统。

---

## G7 验证

```bash
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

### G7 验收标准

- runtime dependency 无明显废弃项；
- worker 保持 one-shot；
- API 不出现常驻无用基础设施；
- Web bundle 有基线记录；
- 没有为了“性能”引入额外复杂度。

**完成后停止。**

---

# Phase G8 — GitHub CI 与最终架构验收

**优先级：最终**

当前目标：

> 每次 PR 不仅证明代码能 build/test，还证明架构没有明显回退。

---

## G8.1 GitHub Actions

新增：

```text
.github/workflows/quality.yml
```

触发：

```yaml
on:
  pull_request:
  push:
    branches:
      - main
```

只做 quality gate，不 deploy。

---

## G8.2 CI 步骤

使用：

```text
Node 22
pnpm 10.0.0
```

步骤：

```bash
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
```

如 native `better-sqlite3` 构建需要 pnpm allow-build 设置：

修现有 pnpm 配置。

不要：

- 切换 DB；
- 改成 mock production dependency；
- 跳过 tests。

---

## G8.3 architecture warning 在 CI 的处理

Hard violation：

```text
exit 1
```

Warning：

```text
输出
exit 0
```

例如：

### Hard

- Redis；
- Prisma；
- packages -> apps；
- web -> db；
- domain -> db；
- prohibited infra。

### Warning

- file size；
- duplicate CSS（如仍存在合法 allowlist）。

---

## G8.4 安全最终矩阵

至少验证：

- A 不得看到 B 工资；
- hidden fields 不离开 employee JSON；
- explicit visibleFields [] 写入被拒绝；
- historical/default [] 兼容；
- netAmount visible；
- batch withdrawn inaccessible；
- item withdrawn inaccessible；
- confirmation disabled 409；
- failed-only resend；
- concurrent single send；
- unique delivered count；
- sent <= total；
- session 8h；
- production HTTPS；
- production absolute DB path；
- archive 12 months；
- authorization metadata only；
- employee list no other employee decrypt；
- report authorized batches only；
- admin detail works；
- architecture dependency direction passes。

---

## G8.5 public GitHub secret/history audit

仓库是 public。

运行：

```bash
git log --all --oneline
git log --all -- .env
git log --all -- '*.sqlite' '*.db'
git log --all -- '*.xlsx' '*.xls'
```

工作树：

```bash
find . -maxdepth 5 -type f \
  \( -name '.env' -o -name '*.sqlite' -o -name '*.db' -o -name '*.xlsx' -o -name '*.xls' \) \
  -print
```

敏感变量搜索：

```bash
rg -n "DINGTALK_CLIENT_SECRET|SALARY_ENCRYPTION_KEY|SESSION_SIGNING_KEY" .
```

区分：

- variable name；
- `.env.example` placeholder；
- real secret。

若真实 secret 曾 commit：

```text
rotate
```

只删除当前文件不够。

history rewrite 必须另行用户授权。

---

## G8.6 最终工程指标

最终不追求漂亮数字，但检查：

### Web

```text
App.tsx 只负责 composition
主要 page/feature 职责单一
```

### API

```text
SalaryService 不再明显多职责
或有合理保留说明
```

### DB

```text
summary / item / full batch 读取意图清晰
```

### CSS

```text
无明显依赖偶然 import order 的跨文件重复
```

### Dependencies

```text
无 Redis/Postgres/ORM/MQ 回归
```

### Runtime

```text
Web + API + SQLite + one-shot worker
```

---

## G8.7 最终报告

必须报告：

1. 当前 main baseline；
2. 已完成 Phase；
3. 未执行 Phase；
4. test；
5. typecheck；
6. build；
7. architecture:check；
8. CI；
9. security matrix；
10. secret/history audit；
11. architecture warnings；
12. 仍存在的合理技术债；
13. 上线人工项。

---

# 6. 推荐执行顺序

```text
G1  正确性小收口
 ↓
G2  敏感数据最小读取
 ↓
G3  Architecture Guardrails
 ↓
G4  Web 测试 + App 结构拆分
 ↓
G5  CSS 职责与重复收口
 ↓
G6  Backend 条件轻拆
 ↓
G7  Runtime / dependency 轻量审查
 ↓
G8  CI + 最终验收
```

为什么把 G3 放在结构拆分前：

> 先建立守门规则，再重构；之后每一次拆分都可以立即知道是否破坏依赖方向。

---

# 7. 当前优先级

## P1

### 1. 数据最小读取

当前最有价值的安全/架构优化。

### 2. delivered 唯一员工计数

低改动、高确定性。

### 3. Architecture Guardrails

防止未来回退。

---

## P2

### 4. App.tsx

当前最大可维护性债务。

### 5. CSS

拆文件已经完成，但职责仍需收口。

### 6. SalaryService

在 G1/G2 后再决定拆分，不提前强拆。

### 7. Runtime dependency

以“无冗余”为目标，不追求极端零依赖。

---

# 8. Codex 固定执行模板

用户：

```text
执行 CODEX_TASKS.md Phase G2
```

Codex 必须：

```text
1. 只执行 G2
2. 读取 AGENTS.md
3. 读取 G2
4. git status
5. branch
6. latest commit
7. 阅读当前实现
8. 阅读现有测试
9. 行为修改测试先行
10. 最小修改
11. focused tests
12. full tests
13. typecheck
14. build
15. architecture:check（G3 完成后）
16. git diff --check
17. 报告
18. STOP
```

不得自动进入 G3。

---

# 9. Codex 报告必须回答的架构问题

每个 Phase 完成时增加：

```text
Architecture impact
```

回答：

### Dependencies

```text
是否新增 runtime dependency？
如有，为什么？
```

### Processes

```text
是否新增服务/worker/timer？
```

### Data access

```text
是否扩大工资读取/解密范围？
```

### Boundaries

```text
是否新增跨 package/app import？
```

### Size

```text
哪些文件超过 architecture warning？
```

### Duplication

```text
是否新增明显重复业务逻辑 / CSS selector？
```

这部分不需要长篇解释。

没有变化写：

```text
none
```

---

# 10. Definition of Done

项目最终不是“拆成很多小文件”就算完成。

真正完成必须满足：

```text
Security
  +
Correctness
  +
Minimal sensitive-data access
  +
Clear responsibility boundaries
  +
No unnecessary infrastructure
  +
No unnecessary runtime dependencies
  +
Automated architecture guardrails
  +
Tests / typecheck / build / CI
```

最终目标：

> 让这个工资条应用继续保持为一个小而完整、容易部署、容易审查、容易修改的内部系统。

不是：

> 把它升级成一个需要专业平台团队维护的“企业级框架项目”。

---

# 11. 明确不在本轮范围

除非用户以后单独授权，不执行：

- 互动卡片；
- action_card；
- OAuth 待办；
- token vault；
- 远程通知撤回；
- Redis；
- MQ；
- ORM；
- PostgreSQL；
- BI 集成；
- microservice；
- API gateway；
- Kubernetes；
- Docker orchestration；
- React Router；
- Redux；
- React Query；
- UI redesign；
- 全量端到端真实工资通知测试。

这些未来可以单独设计。

不能因为存在历史文档就认为已经授权。

---

# 12. 下一步

当前 G0 已完成。

下一次 Codex 最合理的执行指令是：

```text
请先阅读 AGENTS.md 和 CODEX_TASKS.md。

只执行 Phase G1。

严格测试先行；完成 focused tests、pnpm test、pnpm typecheck、pnpm build 和 git diff --check。

完成后报告 Architecture impact，然后停止，不要进入 G2，不要 push/merge，除非我另行授权。
```

G1 合并后：

```text
再执行 G2
```

G2 完成后再建立 G3 architecture guardrails。

这样可以避免：

```text
一边拆架构
一边修敏感数据路径
```

造成难以 review 的大 diff。
