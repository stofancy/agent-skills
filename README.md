# Agent Skills

一组可移植的 Agent Skill，覆盖代码评审交付、部署预检、Lark 消息发送、网页研究与多代理任务编排。

## 收录范围

本仓库只包含本机未登记外部来源、且经发布前脱敏审查的自建 Skill：

- `code-review-flow`：代码评审流程——先冷启动理解 PR（需求对应、变更地图、为什么、边界与风险），再产出带证据与置信度的结论，最后按需把结论交付给作者；HTML/PNG 是可选载体。
- `deploy-preflight`：通用发布预检、SSH 排障、备份流式验证与可逆生产 smoke。
- `feishu-im-send`：Lark 消息的内容闸门、不可变发送计划、dry-run 与确认保护。
- `results-first-persona`：结论优先、保留行动信息的协作沟通风格。
- `searxng-web-read`、`searxng-web-search`、`searxng-web-research`、`searxng-web-source-evaluation`：基于 SearXNG CLI 的检索、阅读、研究与来源评估流程。
- `skill-governance`：Skill 的职责、触发、引用和执行边界审查。
- `team-lead`：在用户明确要求团队协作时，管理任务图、受控 fan-out、验收和熔断。

官方、第三方和有专有许可的已安装 Skill 不在本仓库中，也没有被改为 MIT。

## 安装

按所用 Agent 平台的 Skill 安装规范，将所需目录复制或链接到该平台的 Skills 目录。每个 Skill 的 `SKILL.md` 是入口；只加载任务需要的引用文件与脚本。

## 配置与安全

- 不提交 token、Cookie、API key、用户/群组 ID、profile 名、私有地址或本地运行记录。
- **提交前跑 `scripts/leak-check.sh`**（`scripts/leak-check.sh <rev>` 可检查某个提交）：命中组织/项目标识、内部服务名、本地绝对路径、私有知识库路径、真实工单号与测试计数、凭据与身份中任意一条即失败。先改写成通用表述或占位符，再提交。
- `feishu-im-send` 的 profile、身份和收件人需由使用者在安全配置中维护，并在执行时显式提供。
- SearXNG Skill 的 `.searxng-cli.json` 使用占位 package 名；替换为你的 CLI 包或按你的运行时规范删除该元数据。
- `team-lead` 仅保留 harness 中立的控制面；组织专用模型路由和外部执行器适配器不随仓库发布。

## 许可证

本仓库中原创内容采用 [MIT License](LICENSE)。外部工具、服务和品牌名称归其各自权利人所有。

`code-review-report` 内嵌 Noto Sans SC 子集（常用汉字，© 2014-2021 Adobe，SIL Open Font License 1.1），许可全文见 `skills/code-review-report/assets/OFL.txt`。
