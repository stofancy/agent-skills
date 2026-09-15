# 故障排查（仅当发送/list 报错时读）

成功路径**不要**运行 `whoami`、`profile list`、`--help`。只有遇到认证、scope、profile 或 `Bot/User can NOT be out of the chat` 错误才读本文件，只处理已发生的错误。

所有命令带环境变量：`LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1`

## 找不到 lark-cli

- 默认依赖 PATH 中的 `lark-cli`。
- 自定义安装位置：设 `FEISHU_SEND_LARK_CLI` 为单一可执行文件路径（只表示可执行文件，不附带参数）。
- 报 `lark-cli executable not found`：检查 PATH，或显式设置 `FEISHU_SEND_LARK_CLI`。

## 身份 / token 诊断

```bash
lark-cli auth status --json --verify
```
输出含 `identities.user`/`identities.bot` 的 `status`、`verified`、`tokenStatus`。快速查看用 `whoami`。

## Scope 缺失

- **user** 缺 scope：`lark-cli auth login --scope "im:chat im:message im:message.send_as_user"`（一次写全）。
- **bot** 缺 scope：**不能**对 bot 做 `auth login`——去开发者后台按报错里的 scope-apply 链接申请，**申请后须「版本管理与发布」发版才生效**；不要尝试用 CLI 修复 bot scope。

## 出群：`Bot/User can NOT be out of the chat`

该身份不在目标群。**不要自动切身份硬发**。做法：
- 告知用户当前身份不在该群；
- 要求用户把该身份加入群，或明确批准切换身份后重新定位、重新 dry-run、重新确认。

## Profile

- 不自动 `profile use`。profile 是用户显式选择或故障恢复动作。
- 只在用户明确要求时切换：`lark-cli profile use <name>`。
- 过期则 `lark-cli auth login`，不要沿用记忆里的旧 profile 名。

## 成功判定

必须同时满足：退出码 0 + JSON 可解析且 `ok == true` + 存在非空 `data.message_id`。缺一即报告失败或结果未知。不要按顶层 `code == 0` 判断。此规则与 SKILL.md 门闩同源，改动须同步两处。

## 凭据保密

- 禁止输出 token、`Authorization` header。
- 禁止 `-v`、`--trace`、`set -x`。
- 错误时保留结构化 stderr 中的 `error.message`、`hint`、`permission_violations`、`console_url`，但不泄露凭据。
