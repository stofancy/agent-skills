# 预算、状态与证据

## 受控 fan-out

- 首次委派前，Lead 把当前 ready tickets、最大 live workers、总创建/替换次数、ticket 超时和停止条件写入 mission 账本。只有依赖图中已命名且有净收益的 ticket 能获得 worker，不为"还可以多看一眼"动态扩容。
- 只有 Lead 可以创建、续接、替换或停止 worker；所有 worker 不得继续派生代理。
- live 含 starting、running、idle、waiting、review、verify；completed、failed、cancelled 和经 Lead 确认不可恢复的 lost 不占 live 预算。不得用 idle 规避上限。
- 宿主与 provider 的并发限制是运行时技术天花板，只能收窄已公布的 mission 预算，不能自动扩大它；数字从实际配置或能力查询读取，不在文档固化。
- 每个 worktree/逻辑边界只允许一个写入者；多个只读 worker 可共享源目录，但不得借此修改文件。高风险或热点文件变更时串行化写入。

## 状态（最小可判定）

```text
Mission: draft → active → completed | cancelled | replaced | blocked
Worker: starting → running ⇄ idle | waiting → completed | failed | cancelled | lost
```

awaiting-user、integrating 等作为 active 的备注记录，不设独立状态。idle 与 waiting 是可恢复的暂态：经精确续接回到 running，被 Lead 停止、超时或确认不可恢复时进入终态。状态迁移时更新账本。idle worker 不消耗实际并发但计入 live 预算；相同目标、相同边界且上下文仍有价值时用精确 session/agentId 续接；目标或范围实质改变、上下文已污染或两次失败后，先关闭旧 worker 再在总创建预算内新建。

用户要求停止、mission 取消/替换或预算触发停止条件时，立即停止新派发并终止全部 live workers。完成态必须包含一次 live-worker 清点，不以"没有返回新结果"推断 worker 已停止。

## 证据与接受

每个 worker 回报：mission/ticket ID、角色、通道、状态、base/head SHA、工作目录/分支、影响文件、所做/未做、命令与退出码、原始 artifact 索引、发现或验收结果、风险和下一步。

Reviewer 审查 Builder 的冻结 diff；Verifier 说明被验证的 SHA 和环境。Lead 可抽检或调查证据冲突，但不得把自己改出的代码自行批准。证据无法覆盖完成条件时，结果是未验证或阻塞，不是完成。

## 失败与熔断

1. 记录一次失败的原始证据，分类为 ticket、模型、provider、harness、环境或需求问题。
2. 在已改变一个有意义条件后重试；不对同一等价路径盲重试。
3. 同一等价路径连续两次失败即熔断：停止该通道/worker 组合，记录原因，改用另一通道、重拆 ticket 或请用户决策。
4. worker 超时或丢失时，检查其隔离 worktree、精确 session 和 artifacts；可恢复则续接，否则由新 owner 继承明确状态。
5. 审查与验证矛盾时以可重复的原始证据为准；必要时新增一次性顾问或第二验收者，不以多数投票掩盖高严重度风险。
