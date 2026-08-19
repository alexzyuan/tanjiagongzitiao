# 钉钉工资条内部应用：GitHub Main 第二轮剩余整改任务（Codex 执行版）

> **基线仓库：** `alexzyuan/tanjiagongzitiao`
>
> **基线分支：** `main`
>
> **基线提交：** `3bcd9a6bc1cd3b8fcac86535137b9a8d0cefb7d1`
>
> **基线提交说明：** `harden salary data boundaries and runtime`
>
> 本文件是根据 2026-08-19 GitHub `main` 上的真实代码重新核对后生成。
> 它替代此前基于 ZIP 静态审查生成的 `CODEX_TASKS_NEXT.md`。
>
> **重要：本文件不是“一次全部执行”的授权。**
> Codex 每次只能执行用户明确指定的一个 Phase。
> 每个 Phase 完成后必须停止、报告结果并等待下一次授权。

---

# 一、当前 main 已经完成的整改

以下内容在当前 `main` 已经存在，除非回归测试证明失效，否则不要重新实现。

## 已完成：员工数据边界

- 员工详情响应不再直接返回完整 `StoredBatch.items`；
- 员工列表、详情、view、confirm 使用员工可见字段映射；
- `visibleFields.length > 0` 时由服务端按白名单过滤；
- 历史/default `visibleFields: []` 保留“本人全部业务字段”语义；
- 员工 A/B 跨员工数据隔离已有 API 回归测试。

## 已完成：新 display settings 服务端校验

当前 `SalaryService` 已有 `validateDisplaySettings()`：

- 显式提交 `visibleFields: []` 会拒绝；
- `netAmountField` 不在 `visibleFields` 中会拒绝；
- server 已映射为 HTTP 400；
- salary import 测试已有“显式空 visibleFields 拒绝”用例。

不要把历史 `visibleFields: []` 读取语义改成空字段。

## 已完成：confirmation 后端控制

当前：

- `confirmEmployeeItem()` 已检查 `confirmationEnabled`；
- disabled 时返回 `salary_confirmation_disabled`；
- server 映射 HTTP 409；
- 员工 UI 仅在 `confirmationEnabled` 时显示确认按钮；
- API 已有 disabled confirmation 回归测试。

不要重复实现该能力。

## 已完成：单员工发送 in-flight guard

当前 `sendItem()` 已有：

- `inFlightItemSends`；
- `${batchId}:${employeeUserId}` key；
- 并发第二次请求返回 `salary_item_send_in_progress`；
- `finally` 释放 guard；
- API 已有 concurrent single send 测试；
- HTTP 409 映射已经存在。

不要引入 Redis、BullMQ 或消息队列替换当前单实例保护。

## 已完成：管理员 batch summary 基础

当前：

- `SalaryStore.listBatchSummaries()` 已存在；
- `AuthorizationService.accessFor()` 已使用 summary；
- `SalaryService.list()` 已使用 summary；
- 管理端 batch 列表已经不需要完整 items。

不要回退成用 `listBatches()` 做管理员授权判断。

## 已完成：幽灵基础设施清理

当前 `main` 已经不再依赖：

- Prisma；
- PostgreSQL；
- Redis；
- BullMQ；
- ioredis；
- web 的 TanStack；
- worker 的无关 DingTalk 依赖；
- web / dingtalk 的无引用 zod。

当前 package 状态以 SQLite 为准。

不要重新引入上述基础设施。

---

# 二、全局工程约束

所有 Phase 均遵守以下规则。

## 技术栈保持

继续使用：

- Fastify；
- React；
- TypeScript；
- SQLite / WAL；
- Vitest；
- Vite；
- pnpm workspace；
- 普通 CSS。

未经用户另行授权，不引入：

- 微服务；
- Redis；
- PostgreSQL / MySQL；
- ORM；
- 消息队列；
- Redux；
- React Query；
- 新 Router；
- Tailwind；
- CSS Modules；
- styled-components；
- CQRS；
- Event Sourcing；
- controller/repository/usecase/factory/provider 多层架构。

## 安全边界保持

任何 Phase 都不得破坏：

- 员工只能获取自己的工资数据；
- hidden fields 不离开员工接口服务端；
- 管理员权限 fail closed；
- 工资字段继续 AES-256-GCM 加密落盘；
- 不在普通日志、错误日志、audit metadata 中输出真实工资金额、工资字段、银行卡号、身份证号、密钥、AppSecret；
- 不发送真实员工工资通知做自动化测试；
- “撤回”只代表本应用内撤销访问和本地状态/存证；
- 不声称钉钉已收到的通知能被远程删除；
- 当前已验证工资触达渠道仍是工作通知 `link`；
- 本轮整改不得顺带接互动卡片；
- 不启用未完成 OAuth/token/调度链路的“未查看/未确认待办”。

## Git 纪律

开始 Phase 前：

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

要求：

- 不覆盖用户未提交改动；
- 不执行 `git reset --hard`；
- 不执行 `git clean -fd`；
- 不自动 push；
- 不自动 merge；
- 不自动 deploy；
- 如果需要大规模重构，使用 `codex/` 前缀分支；
- 用户没有明确要求 push/PR 时，只保留本地改动和报告。

## TDD / 验证纪律

对行为 bug：

1. 阅读当前实现；
2. 阅读当前测试；
3. 先增加失败回归测试；
4. 确认修复前测试失败；
5. 做最小修改；
6. 目标测试通过；
7. 相关模块测试通过；
8. 全量门禁通过；
9. `git diff --check`；
10. 完成后停止。

全量门禁：

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

只有真实执行成功才能报告“通过”。

---

# Phase G0 — GitHub 基线、项目指令和文档收口

**优先级：P1 / 后续 Codex 执行前建议先完成**

## 目的

当前 GitHub 根 `AGENTS.md` 仍是较早的 30 行版本；
`HANDOFF.md` 仍把“互动卡片接入”描述成当前新增方向。

这与当前安全整改目标存在明显执行风险：

- Codex 可能把互动卡片当成本轮任务；
- 根 `AGENTS.md` 没有完整记录员工数据隔离、Session、撤回、重试、SQLite、工程结构和 Phase 授权规则；
- 当前仓库没有一份与最新 main 对齐的 Codex phase 清单。

本 Phase 只同步项目级执行规则和真实状态，不改业务代码。

## 允许修改

- `AGENTS.md`
- `HANDOFF.md`
- `README.md`
- 新增/替换根 `CODEX_TASKS.md`

## 明确禁止

- 不改 `apps/**` 业务代码；
- 不改 `packages/**`；
- 不接互动卡片；
- 不改钉钉投递协议；
- 不改数据库。

## Task G0.1 — 用完整项目规则更新 AGENTS.md

根 `AGENTS.md` 至少明确：

### 安全

- employee DTO 必须服务端隔离；
- hidden fields 服务端过滤；
- Session 8h；
- Cookie HttpOnly/SameSite/Secure；
- AES-256-GCM；
- 日志不得写敏感工资；
- withdraw 本地语义；
- failed retry 只处理 failed；
- delivered 不重复；
- `sent <= total`；
- 生产 HTTPS；
- 生产 SQLite 绝对路径；
- 12 月员工访问限制。

### 架构

明确禁止：

```text
Redis
PostgreSQL/MySQL
ORM
队列
Redux
React Query
新 Router
Tailwind
复杂 DDD/CQRS/Event Sourcing
```

### 钉钉

明确：

```text
当前已验证 = asyncsend_v2 link
本项目不使用 DING
互动卡片属于后续独立功能
整改 Phase 不顺带接入
```

### Phase 授权

明确：

```text
CODEX_TASKS.md 列出多个 Phase != 一次全部授权
用户只授权当前指定 Phase
完成后必须停止
```

## Task G0.2 — 更新 HANDOFF.md

删除/改写容易误导 Codex 的内容：

不要再把：

```text
当前新增方向是使用钉钉互动卡片替代普通工作通知链接
正在处理互动卡片集成
下一步默认接互动卡片
```

描述成当前整改任务。

可以保留历史研究记录，但必须改成：

```text
互动卡片是独立未来功能；
当前 main 的生产触达仍是已验证的工作通知 link；
除非用户另行授权，不进入互动卡片开发。
```

HANDOFF 的“当前分支”应更新成真实 GitHub 状态，不继续写已经删除的
`codex/salary-slip-internal-app` 为当前开发分支。

## Task G0.3 — 将本文件作为当前 CODEX_TASKS.md

建议根目录最终只有一份当前执行清单：

```text
CODEX_TASKS.md
```

不要同时留下多个名字相似、互相冲突的整改任务文件让 Codex 猜优先级。

旧历史 plan 可以保留在 `docs/`，但根执行规则必须明确它们是历史设计记录，不是当前授权。

## Task G0.4 — README 与实际架构一致

检查 README：

- SQLite；
- cron/systemd archive；
- link 工作通知；
- 8h Session；
- backup；
- HTTPS；
- 当前未启用的功能。

只修真实不一致，不大改文案。

## 验证

```bash
git diff --check
git diff -- AGENTS.md HANDOFF.md README.md CODEX_TASKS.md
```

由于本 Phase 不改代码，仍建议执行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

若只是文档改动且环境不能运行，必须明确说明未验证，不能伪造通过。

## 验收标准

- Codex 读根文件不会误以为互动卡片是当前任务；
- 根 AGENTS 包含完整安全/工程边界；
- 根目录有唯一当前 Phase 清单；
- 不修改业务代码。

**完成后停止。**

---

# Phase G1 — 剩余业务正确性和前端语义收口

**优先级：P1**

## 目的

当前 P0/P1 主体修复已存在，本 Phase 只收掉剩余的小型正确性问题：

1. 单员工发送完成状态的 delivered 统计仍按 delivery 行数计算；
2. confirmation disabled 时员工页底部文案仍写“查看和确认时间将生成存证”；
3. display settings 的关键 validation 测试还不完整；
4. web 测试对员工 confirmation / display settings 语义覆盖不足。

## 主要文件

- `apps/api/src/modules/salary/service.ts`
- `apps/api/src/server.ts`（只有确有错误码遗漏才改）
- `apps/api/test/salary-delivery.test.ts`
- `apps/api/test/salary-import.test.ts`
- `apps/web/src/pages/EmployeeSalary.tsx`
- `apps/web/src/App.test.tsx`
- 如更适合，可新建 `apps/web/src/pages/EmployeeSalary.test.tsx`

## Task G1.1 — 修复 sendItem deliveredCount 唯一员工语义

当前 `sendItem()` 成功后存在类似：

```ts
const deliveredCount = this.store
  .listDeliveries(batchId)
  .filter((delivery) => delivery.status === "delivered").length;
```

该语义统计的是 delivery rows，不是唯一成功员工。

改成：

```text
unique delivered employeeUserId count
```

要求：

```text
deliveredUnique <= total
```

只有唯一 delivered 员工数等于 `total` 才把 batch 收口成 `sent`。

不要删除历史 delivery 行。

不要通过清洗历史记录来掩盖统计问题。

### 回归测试

构造：

- batch 2 人；
- delivery history 中 A 存在两条 delivered；
- B 尚未 delivered；
- 触发与状态相关的逻辑；
- 不能把 2 条 A delivery 当成 2 个员工。

然后 B 真正 delivered 后：

```text
unique delivered = 2
batch = sent
sent = 2
total = 2
```

## Task G1.2 — confirmation disabled 时修正文案

当前员工 UI 已经正确隐藏确认按钮，但底部仍固定显示：

```text
查看和确认时间将生成存证记录
```

改为基于 settings：

### enabled

```text
查看和确认时间将生成存证记录
```

### disabled

```text
查看时间将生成存证记录
```

不要改存证逻辑。

## Task G1.3 — 补 display settings 校验测试

当前已有：

```text
显式 visibleFields: [] -> 400 salary_visible_fields_required
```

再增加：

### API

1. `netAmountField` 不在 `visibleFields` -> 400；
2. 创建模板时 `visibleFields: []` -> 400；
3. 创建模板时 net amount hidden -> 400；
4. 合法 settings -> 正常成功；
5. 没显式传 displaySettings 的历史/default 行为保持，避免误伤旧语义。

如果当前 schema 已经能防止空字符串字段，可复用；不要重复造 validation 框架。

## Task G1.4 — 增加员工 UI 关键行为测试

当前 web `App.test.tsx` 测试很少。

至少增加：

1. `confirmationEnabled=false` 不显示确认按钮；
2. false 时 footnote 不出现“确认时间”；
3. true 时显示确认按钮；
4. true 时 footnote 包含确认存证语义；
5. `SalarySlipPreview` 在 `visibleFields: []` 时与历史服务端语义一致：展示所有 fields，而不是假装隐藏所有字段；
6. 非空 visibleFields 只预览白名单字段。

不要使用大面积 DOM snapshot。

## 验证

```bash
pnpm --filter @salary/api test -- salary-delivery.test.ts salary-import.test.ts
pnpm --filter @salary/web test

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 验收标准

- delivery count 按员工去重；
- `sent <= total`；
- confirmation UI 与文案完全一致；
- display validation 有完整回归测试；
- 不引入新依赖。

**完成后停止。**

---

# Phase G2 — 敏感工资数据最小读取

**优先级：P1**

## 目的

当前 `main` 已解决：

```text
AuthorizationService -> listBatchSummaries()
SalaryService.list()  -> listBatchSummaries()
```

但仍有两个明显的过度读取路径：

### 员工工资条列表

当前 `listEmployeeSlips()` 仍从：

```ts
store.listBatches()
```

开始。

SQLite `listBatches()` 会加载完整 batch items 并解密工资字段。

结果：

> 员工 A 只是打开自己的工资条列表，服务端可能为遍历 batch 解密大量其他员工工资数据。

虽然最终 HTTP DTO 没泄露，但不符合敏感数据最小读取原则。

### 报表

当前 `ReportService.summary()`：

```ts
store.listBatches()
  .filter(canManageBatch)
```

意味着：

> 对 sub-admin / batch-admin，可能先读取/解密全部 batch，再在内存过滤未授权 batch。

最终响应会去掉 items，但未授权工资已经在服务器业务路径内被不必要读取。

## 主要文件

- `apps/api/src/modules/salary/service.ts`
- `apps/api/src/modules/reports/service.ts`
- `apps/api/test/employee-access.test.ts`
- `apps/api/test/authorization-boundary.test.ts`
- 报表测试（如无则新增）
- `packages/db/src/store.ts`
- `packages/db/src/sqlite-store.ts`
- `packages/db/test/sqlite-store.test.ts`

## 明确禁止

- 不引入 repository 层；
- 不引入 ORM；
- 不改加密算法；
- 不改 HTTP 产品语义；
- 不为了优化写复杂缓存。

## Task G2.1 — 员工列表改用 batch summary + 当前员工 item

目标：

```text
读取 metadata
+
只查询当前 employee item
```

不再：

```text
listBatches() -> 解密所有 items
```

优先简单实现。

允许路线 A：

```text
listBatchSummaries()
for each summary:
  getEmployeeItem(batchId, currentEmployee)
```

对内部小应用，N 个轻量 metadata + 单员工 row 查询可以接受。

如果当前 DB 实现表明增加：

```text
listEmployeeBatchIds(employeeUserId)
```

会明显更简单，也可以增加该窄接口。

不要新增泛型 query/repository framework。

## Task G2.2 — employeeAccessibleSlip 不要求完整 StoredBatch

当前 employee access helper 如果依赖完整 `StoredBatch`，调整成只依赖访问判断所需 metadata：

至少：

- id；
- payrollMonth；
- state；
- displaySettings；
- 必要的 batch metadata。

员工 view / confirm fingerprint 也只应依赖 fingerprint 所需 metadata + 当前 item。

禁止为了 fingerprint 获取同批其他员工 items。

## Task G2.3 — ReportService 先授权，再解密

重构顺序：

```text
1. listBatchSummaries()
2. 用 access/canManageBatch 过滤有权限 IDs
3. 过滤 payrollMonth
4. 只对最终允许的 IDs 调 getBatch()
5. 用这些 items 算 salaryTotals
6. HTTP response batches 继续只返回 metadata + report metrics
```

必须保证：

```text
sub-admin 不读取未授权 batch 完整工资 items
```

## Task G2.4 — 增加“没有不必要完整读取”的测试

测试重点不是性能 benchmark，而是调用边界。

可以使用 fake/spy store：

### Authorization 已有目标

继续确保：

```text
accessFor() 不调用 listBatches()
```

### Employee list

证明：

```text
listEmployeeSlips() 不调用 listBatches()
```

并保持：

- A 看不到 B；
- hidden fields 不泄漏；
- withdrawn/archive/12m 规则不回归。

### Report

fake store 让：

```text
getBatch(unauthorizedBatchId)
```

直接抛出特殊测试错误。

sub-admin summary 必须仍成功，从而证明未读取未授权 batch。

## Task G2.5 — SQLite summary 路径不能解密工资

检查 `listBatchSummaries()` SQL/mapper：

- 不读取 encrypted salary payload；
- 不调用 `decryptSalaryPayload()`；
- 只读取 batch metadata / display settings。

若当前已经满足，只补测试，不重写。

## 验证

```bash
pnpm --filter @salary/db test -- sqlite-store.test.ts
pnpm --filter @salary/api test -- employee-access.test.ts authorization-boundary.test.ts
pnpm --filter @salary/api test

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 验收标准

- Authorization 不解密工资；
- batch list 不解密工资；
- employee list 不解密其他员工工资；
- report 不解密未授权 batch；
- report 需要算 totals 的授权工资仍可以正常解密计算；
- HTTP 行为不回归。

**完成后停止。**

---

# Phase G3 — 前端行为测试补强 + App.tsx 按功能拆分

**优先级：P2**

## 目的

当前：

```text
apps/web/src/App.tsx ≈ 2383 行
```

员工端已经抽到：

```text
pages/EmployeeSalary.tsx
```

但 App.tsx 仍包含多个大型管理页面和工资功能组件。

本 Phase：

> 先补最低限度行为测试，再机械移动代码。

不改变 UI，不改变 API，不改变业务语义。

## 当前建议结构

允许按实际依赖微调：

```text
apps/web/src/
├── App.tsx
├── api.ts
├── pages/
│   ├── EmployeeSalary.tsx
│   ├── SalaryManagement.tsx
│   ├── EvidenceCenter.tsx
│   ├── ReportCenter.tsx
│   ├── PermissionCenter.tsx
│   └── SettingsCenter.tsx
├── features/
│   └── salary/
│       ├── ImportWizard.tsx
│       ├── ManualPanel.tsx
│       ├── BatchDetail.tsx
│       └── SalarySlipPreview.tsx
└── components/
    ├── Modal.tsx
    ├── Field.tsx
    ├── Toggle.tsx
    ├── Status.tsx
    └── EmptyState.tsx
```

不要为了匹配目录树创建没有实际职责的 wrapper。

## Task G3.1 — 拆分前补管理端 smoke behavior tests

当前 `App.test.tsx` 只有少量用例。

先覆盖：

1. batch list 请求；
2. 选择/加载当前 batch detail；
3. ImportWizard 入口；
4. Evidence 页面基础请求；
5. Report 页面基础请求；
6. Permission 页面基础请求；
7. Settings 页面基础请求。

测试目标：

> 移动文件以后能够证明行为未变。

不要测试 CSS class 细节。

## Task G3.2 — 先画真实组件依赖

执行：

```bash
rg -n "^export function |^function [A-Z]|^const [A-Z].*=>" apps/web/src/App.tsx
```

按照职责分类：

- 顶层 App/session/nav -> `App.tsx`
- 页面 -> `pages`
- 工资功能 -> `features/salary`
- 复用无业务组件 -> `components`

只被一个页面使用的小 helper 跟着页面走。

不要创建 `utils.ts` 大杂烩。

## Task G3.3 — 分小步移动

建议顺序：

1. `EvidenceCenter`
2. `ReportCenter`
3. `PermissionCenter`
4. `SettingsCenter`
5. `BatchDetail`
6. `ManualPanel`
7. `ImportWizard`
8. `SalarySlipPreview`
9. 通用组件
10. `SalaryManagement`

每移动一个主要单元：

```bash
pnpm --filter @salary/web test
pnpm --filter @salary/web typecheck
```

不要一次搬完再修。

## Task G3.4 — App.tsx 最终职责

最终主要保留：

- employee/admin 顶层入口判断；
- session/identity；
- module nav；
- refreshKey 等少量跨页面组合；
- 顶层 layout。

如果最终 `App.tsx` 仍直接实现：

```text
ImportWizard
ReportCenter
PermissionCenter
SettingsCenter
BatchDetail
```

则 Phase 尚未完成。

## 明确禁止

- 不加 React Router；
- 不加 Redux；
- 不加 React Query；
- 不改视觉；
- 不顺便重写 API 层；
- 不做全项目 rename；
- 不把 props 改成复杂 context 体系。

## 验证

```bash
pnpm --filter @salary/web test
pnpm --filter @salary/web typecheck
pnpm --filter @salary/web build

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 验收标准

- App.tsx 明显变成顶层组合文件；
- 大页面在独立文件；
- 原行为测试通过；
- 无新状态/路由框架；
- UI 不主动 redesign。

**完成后停止。**

---

# Phase G4 — CSS 重复规则和职责收口

**优先级：P2**

## 当前状态

CSS 已经成功从旧大单文件拆成：

```text
base.css
components.css
employee.css
import.css
salary.css
```

这个拆分方向正确。

但当前仍有重复/覆盖。

已确认示例：

```text
.directory-result
```

在 `components.css` 和 `import.css` 都存在不同声明。

`base.css` 仍约 962 行，也混合了 drawer、modal、permission、directory picker 等较多组件/业务样式。

## 目的

不 redesign，只做：

```text
职责唯一
+
消除无意义重复
+
保留当前最终 cascade
```

## Task G4.1 — 用脚本列出重复 selector

写一个一次性 Node/TS 或 shell 检查脚本，输出跨 CSS 文件重复的普通 selector。

该脚本只用于检查，不要求引入 CSS parser 新依赖。

人工区分：

- 正常 media query override；
- print override；
- modifier/state；
- 真正跨文件重复 base selector。

## Task G4.2 — 先处理确定重复

优先检查：

```text
.directory-result
directory-search / directory-picker 相关
modal / drawer 相关
setting-row
metric
salary-heading
employee-sheet
```

如果 selector 在两个文件中对应不同页面、只是名字碰撞：

优先改成更具体、现有作用域 class；
不要依赖 import 顺序“谁最后覆盖谁”。

如果本来就是同一个通用组件：

只保留在 `components.css`。

## Task G4.3 — 减轻 base.css 职责

建议：

`base.css` 保留：

- root variables；
- reset；
- body；
- app shell；
- sidebar/topbar；
- page base；
- typography；
- 通用 button/input 基础。

可迁移：

- modal/drawer -> components；
- permission-specific -> 对应 page/style；
- directory picker -> components 或 permission；
- salary-specific -> salary；
- import-specific -> import。

不要求为了行数拆更多文件。

## Task G4.4 — 保留视觉

迁移重复规则前，必须对照原 cascade 最终值。

不改变：

- colors；
- spacing；
- layout；
- responsive；
- print；
- employee salary view；
- modal overlay。

如果环境支持浏览器，人工检查：

- 管理工资页面；
- ImportWizard；
- permission；
- report；
- modal；
- employee detail；
- mobile；
- print。

## 验证

```bash
pnpm --filter @salary/web test
pnpm --filter @salary/web typecheck
pnpm --filter @salary/web build

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 验收标准

- 明显跨文件重复 selector 被消除；
- base.css 不继续承担大量局部业务样式；
- 视觉不主动改变；
- 不引入 CSS framework。

**完成后停止。**

---

# Phase G5 — SalaryService 轻量拆分（条件执行）

**优先级：P2 / Optional**

## 当前状态

当前：

```text
apps/api/src/modules/salary/service.ts ≈ 833 行
```

而且已经增加：

- import orchestration；
- admin batch；
- delivery；
- in-flight guard；
- withdraw；
- employee access；
- view/confirm；
- display settings validation；
- fingerprint。

文件现在已经到了可以认真评估轻量拆分的规模。

## 执行条件

只有完成 G1/G2 后仍满足以下任意两项才执行：

- service.ts > 650 行；
- delivery 逻辑 > 180 行；
- employee access 逻辑 > 150 行；
- 修改 employee 行为需要反复跨越 delivery/import 区域；
- 相关 helper 无法在当前文件中形成清晰局部边界。

否则报告：

```text
当前不拆更合理
```

并停止。

## 推荐最大结构

```text
apps/api/src/modules/salary/
├── routes.ts
├── service.ts
├── import.ts
├── delivery.ts
└── employee.ts
```

不要超过这个复杂度，除非用户另行授权。

## `delivery.ts`

允许承担：

- target selection；
- send batch；
- resend；
- send single；
- withdraw；
- in-flight guard；
- unique delivered count helper；
- delivery status mapping。

## `employee.ts`

允许承担：

- employee accessibility rule；
- employee response mapping；
- visible field filter；
- employee list/detail/view/confirm；
- employee fingerprint input helper。

## `service.ts`

保留：

- 对外编排；
- batch admin 操作；
- templates/sub-admin；
- composition。

## 明确禁止

不要创建：

```text
repository/
usecase/
controller/
factory/
provider/
domain-service/
application-service/
```

不要在拆分时改：

- API contract；
- error code；
- SQL；
- salary encryption；
- delivery rule；
- employee authorization。

## 验证策略

移动 employee：

```bash
pnpm --filter @salary/api test -- employee-access.test.ts authorization-boundary.test.ts
```

移动 delivery：

```bash
pnpm --filter @salary/api test -- salary-delivery.test.ts
```

最终：

```bash
pnpm --filter @salary/api test
pnpm --filter @salary/api typecheck
pnpm --filter @salary/api build

pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 验收标准

- 只有职责清晰度真正提升才拆；
- 不产生多层空转抽象；
- routes 不需大改；
- 行为完全由现有测试保护。

**完成后停止。**

---

# Phase G6 — GitHub CI 与最终验收

**优先级：最终**

## 当前 GitHub 状态

当前 `main` 最新提交没有 GitHub commit status/check 记录。

因此：

> GitHub 上目前不能直接证明 `pnpm test / typecheck / build` 每次提交都通过。

本 Phase 分两部分：

1. 最终本地验收必须做；
2. GitHub Actions CI 推荐做，但如果用户不希望增加 CI 文件，可跳过并明确报告。

## Task G6.1 — 本地全量门禁

必须真实执行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

全部成功。

## Task G6.2 — 安全回归矩阵

至少确认：

- employee A 拿不到 employee B 工资；
- hidden fields 不在员工 JSON；
- historical/default visibleFields [] 兼容；
- explicit empty visibleFields 新配置被拒绝；
- netAmountField 必须可见；
- withdrawn batch 员工不可访问；
- withdrawn employee 员工不可访问；
- confirmation disabled API 409；
- confirmation disabled UI 无按钮；
- retry 不重复 delivered；
- concurrent single send 同实例只发送一次；
- sent <= total；
- unique delivered count 正确；
- Session 8h；
- production HTTP 拒绝；
- production relative SQLite path 拒绝；
- archive >12m 员工不可访问；
- authorization 不读取完整工资；
- employee list 不解密其他员工工资；
- sub-admin report 不解密未授权 batch；
- admin detail 仍可授权读取完整 batch。

## Task G6.3 — 敏感信息扫描

```bash
git status --short

find . -maxdepth 5 -type f \
  \( -name '*.sqlite' -o -name '*.db' -o -name '.env' -o -name '.env.*' \) \
  -print

rg -n "DINGTALK_CLIENT_SECRET|SALARY_ENCRYPTION_KEY|SESSION_SIGNING_KEY" \
  . --glob '!pnpm-lock.yaml'
```

人工区分：

- env 变量名；
- `.env.example` 开发 placeholder；
- 真实 secret。

不得把真实 secret 写进报告。

## Task G6.4 — Public GitHub 额外检查

因为仓库是 public，检查：

```bash
git log --all --oneline
git log --all -- .env
git log --all -- '*.sqlite' '*.db' '*.xlsx' '*.xls'
```

如果任何真实 secret / 工资文件曾进入 Git 历史：

- 不只删除文件；
- 报告需要 rotate secret；
- 需要时另行授权进行 history rewrite；
- 不擅自 force push。

## Task G6.5 — 可选 GitHub Actions CI

如果用户授权增加 CI：

创建简单 workflow：

```text
push / pull_request
Node 22
pnpm 与 packageManager 一致
install
test
typecheck
build
```

不要加入 deploy。

CI 只做质量门禁。

CI 首次成功后，GitHub PR review 才能把 status checks 当作可靠证据。

如果 native `better-sqlite3` 安装需要平台构建配置，按 pnpm 当前实际支持方式处理；
不要为了 CI 改数据库技术。

## Task G6.6 — 最终 diff

```bash
git diff --check
git status --short
git diff --stat
```

确认：

- 没有真实数据库；
- 没有真实工资文件；
- 没有 secrets；
- 没有无关 format；
- 没有 Prisma/Redis/Postgres/BullMQ 回归；
- 没有互动卡片接入；
- 没有未经授权部署配置。

## 最终报告格式

只报告：

1. 完成的 G Phase；
2. 跳过的 G Phase及理由；
3. test/typecheck/build 真实结果；
4. 安全回归矩阵；
5. GitHub CI 是否存在/通过；
6. public repo secret/history 检查结果；
7. 剩余风险；
8. 上线前人工项：
   - HTTPS；
   - SQLite backup/restore 演练；
   - secret 管理；
   - 真实钉钉权限；
   - cron/systemd archive。

---

# 三、推荐执行顺序

```text
G0  项目指令 / HANDOFF / CODEX_TASKS 收口
 ↓
G1  剩余业务正确性 + 前端语义测试
 ↓
G2  敏感工资最小读取
 ↓
G3  前端 App.tsx 拆分
 ↓
G4  CSS 去重
 ↓
G5  SalaryService 轻量拆分（条件执行）
 ↓
G6  GitHub CI（可选）+ 最终上线验收
```

---

# 四、Codex 每次执行固定模板

用户例如只说：

```text
执行 CODEX_TASKS.md 的 Phase G2
```

Codex 必须：

1. 只执行 G2；
2. `git status --short`；
3. 确认当前 branch / commit；
4. 阅读 G2 涉及当前实现；
5. 阅读已有测试；
6. 行为修改先写失败测试；
7. 确认修复前失败；
8. 最小修改；
9. 跑目标测试；
10. 跑全量 test/typecheck/build；
11. `git diff --check`；
12. 报告；
13. **停止，不自动执行 G3。**

如果当前代码已经正确实现某个 task：

- 不机械改；
- 补必要验证；
- 报告“当前已满足，无业务修改”；
- 不为了产生 diff 而改代码。

如果需要跨 Phase 才能正确解决：

- 停止；
- 报告阻塞；
- 等用户重新授权。

---

# 五、当前最值得优先处理的工程问题

以当前 GitHub `main` 为准，优先级为：

## P1

1. employee list 不必要地通过 `listBatches()` 解密大量工资；
2. sub-admin report 先 `listBatches()` 再过滤，可能解密未授权工资；
3. sendItem deliveredCount 应按唯一员工统计；
4. 根 AGENTS/HANDOFF 与当前整改方向不完全一致。

## P2

5. App.tsx 仍约 2383 行；
6. web 行为测试太少；
7. CSS 拆文件已完成，但重复 selector / 职责仍需收口；
8. SalaryService 约 833 行，完成前面整改后再决定是否轻拆。

---

# 六、本轮不要再做的事

以下已经不是当前整改目标：

- 重新实现 Session 8h；
- 重新实现 employee DTO；
- 重新实现 withdraw access；
- 重新实现 failed-only resend；
- 重新实现 single-send in-flight guard；
- 重新清 Prisma / Redis / BullMQ；
- 接互动卡片；
- 做待办 OAuth；
- 换数据库；
- 引入 ORM；
- 重写前端；
- 为了“标准化”增加层级。

当前目标是：

```text
把已经基本安全的内部工资条应用收口成
“数据最小读取 + 行为有回归保护 + 文件职责清晰 + GitHub 可持续 review”
```
