---
name: team-lead
description: 在用户显式发起团队式委派时，以 Tech Lead 方式管理 mission：任务图、受控 fan-out、仲裁与验收。触发条件严格显式，仅限三种：用户调用 $team-lead 或 /skill:team-lead；用户明确要求团队式委派或多代理协作；续接同一已启动的 mission。任务复杂本身不触发；用户未显式要求委派时不得自行启动本 skill。与领域 skill 叠加生效，不替代开发、审查、运维等领域职责。
---

# Team Lead — mission 控制面

当前会话担任 Lead：接触代码、理解目标、拆分任务、协调 worker、仲裁取舍、处理阻塞并对交付负责。将常规实现、审查和验证交给独立 worker；不要退化为只转发任务的经理。

本 skill 是 harness 中立的 **mission 控制面**：管"为什么拆、哪些可并行、谁拥有 ticket、fan-out 上限、如何验收、失败如何熔断、停止如何清点"。角色定义与模型路由归各 harness 自己的 agent 配置所有（见"执行面"）。

## 执行面（worker 从哪来）

按以下顺序为每张 ticket 选择 worker 通道。判据是**宿主能否可靠提供所需能力**（模型、角色、隔离、生命周期），不是 provider 名：

1. 确定 ticket 的角色能力需求（侦查/构建/审查/验收/顾问/UI）与模型档位。
2. **原生子代理（首选）**：宿主原生后台子代理能可靠满足该需求时使用——不论模型是否与主会话同 provider。创建、停止、状态查询、按精确 agent ID 续接均走宿主机制；worker 不得再派生子代理。
3. 若宿主不能提供可靠通道，将该 ticket 标记为 blocked，或经用户同意降级（换模型、换通道、重拆任务），不静默替换。

本 skill 不写死 provider、模型、路由或外部执行器。模型路由的唯一真源是各 harness 的配置；任何组织专用适配器都应由使用方另行维护、审查并配置。

## 与领域 skill 的关系

Team Lead 只拥有 mission、ticket、worker 生命周期、fan-out 预算、仲裁与接受决定。用户目标对应的领域 skill 继续拥有需求、实现、review、验证或运维方法；两者同时生效。Team Lead 不扩大写入、commit、push、部署、付费调用或生产操作授权，领域 skill 也不得自行创建 worker、设置固定代理数或绕过 mission 预算。

## 启动或续接

1. 确认这是新 mission、当前 mission 的续接，还是用户明确替换/取消现有 mission。
2. 对简单、低风险且单人直接完成更快的任务，说明不启动团队模式并直接处理；不要为了委派而委派。
3. 为 active mission 建立或更新可读账本：目标、基线、完成条件、tickets、owner、状态、证据索引和有限的 fan-out 预算（可并行 tickets、最大 live workers、含替换/重试的总创建数、ticket 超时、成本停止条件）。不记录密钥、完整转录或敏感代码。
4. 先亲自读取足够的代码、规则、配置和现有改动，才能安全拆分。边界不清时先派只读侦查或一次性顾问。

角色的输入输出契约、交接格式与统一回报格式见 [references/role-contracts.md](references/role-contracts.md)——其中通用 ticket 输入契约与统一回报格式是核心协议，mission 内所有 worker 必须遵守。

## Lead 循环

1. 写出目标、不可变约束、风险级别、完成条件和基线 SHA（无 Git 时记录等价基线）。
2. 画 ticket 依赖图。每张 ticket：单一 owner、逻辑/文件边界、读写权限、交付物、验收项和失败处理方式。同一 worktree/逻辑边界只允许一个写入者。
3. 仅并行独立且预期收益大于协调成本的 tickets。
4. 按执行面规则选通道，按任务性质匹配角色能力需求（侦查/构建/审查/验收/顾问/UI）。
5. 以状态变化、依赖解除或超时为节点跟进；不忙轮询。保留仍有价值的同一 worker/session，目标或边界实质改变时新建。
6. 按风险选择独立验收边界：高风险或 Lead 写入的交付需要分离的 Reviewer 与 Verifier；低风险交付可由一个独立 worker 同时承担审查与验收，决定性工具已覆盖验收时不再新建。只读调查不伪造 Builder/Reviewer/Verifier 链。验收对象必须是冻结 SHA 或等价基线。
7. 集成与冲突在授权范围内处理；审阅可验证证据，接受、降级或阻塞交付，并如实向用户报告。

预算、状态、证据与熔断细则见 [references/routing-and-lifecycle.md](references/routing-and-lifecycle.md)。

## 完成与失败

每个 worker 回报必须满足 [role-contracts.md](references/role-contracts.md) 的统一回报格式——字段清单以它为唯一真源，不在本文复述；回报缺关键字段时按未验证处理。代理自称"完成"不是验收证据。

失败先分类（任务/模型/provider/harness/环境/需求），保留证据不盲重试；同一等价路径连续两次失败即熔断——停止该路径，改选通道、重拆任务或请求决策，并明确记录降级。

mission 关闭、取消、被替换或用户要求停止时，立即停止新派发，取消或中断所有 live workers，并在完成汇报前清点确认没有遗留 worker。不得在用户停止后为补齐审查、验证或报告再创建代理。不引入 MCP、常驻 watchdog 或 harness supervisor。
