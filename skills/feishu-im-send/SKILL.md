---
name: feishu-im-send
description: 飞书/Lark 消息的"结果导向编写 + 安全发送门闩"。用户只要表达"发到群里""群里说一声""通知/公告/状态同步""@同事""发 review 结论"或"请人 review PR"，即使没提 lark-cli，也必须使用本 skill。它既约束消息内容形态（结论优先、发结果不发过程、去 AI 味），也约束安全传输（接收方定位、user/bot 身份、dry-run、显式确认、幂等发送）。禁止未确认发送、猜群、切身份试发、反复搜索，也禁止把审查过程/工具名/测试清单当正文发送。支持群聊（oc_）和发给个人（ou_ 私聊）；查历史、撤回和纯搜群使用 lark-im。
metadata:
  requires:
    bins: ["lark-cli"]
  cliCompatibility:
    verifiedAt: "2026-08-14"
    note: "已核验 +messages-send / +chat-search / chats get / contact +get-user / contact +search-user 当前参数。lark-cli 升级后需重跑非发送兼容性检查（--help/schema 校验 + 脚本语法 + prepare 受控 dry-run）。"
---

# 用最短安全路径发送飞书群消息

## 目标

把一次飞书消息发送收敛成不可变计划：

`接收方(群 oc_ 或人 ou_) + identity + content flag + 完整正文 + idempotency key`

先用该计划 dry-run，用户确认后只移除 `--dry-run` 执行。不要在确认后重新拼正文、换身份或重新选接收方。

所有命令都带下面两个环境变量，避免 notifier 污染 JSON：

```bash
LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1
```

已验证命令：

- 群名查找：`lark-cli im +chat-search`
- 已知 ID 校验：`lark-cli im chats get`
- 浏览已加入群：`lark-cli im +chat-list`
- 发送：`lark-cli im +messages-send`（不是 `+messages-create`）

不要为发现命令而运行 `--help`、`schema`、`whoami` 或 `profile list`。认证或权限失败时才读 [references/troubleshooting.md](references/troubleshooting.md)。

## 先确定这条消息要完成什么（动笔前必做）

**这是本 skill 的第一步。** 安全流程只解决"怎么发"，本节解决"发什么"。跳过本节，消息必然滑向全面汇报。

发送前在内部确定四项，能从上下文推断时**不得额外追问**；只有目标动作会因歧义而改变时才问：

1. **主读者**：这条消息给谁看？他带着什么背景，最想得到什么？
2. **消息类型**：结果通知 / 状态同步 / 决策请求 / 行动指派 / 纠错 / 邀请提醒。用户说"结论""结果""评审完了"时默认按**结果通知**处理，不按过程汇报处理。
3. **一句话核心**：读者看完能复述的那一句。必须能放在第一行；若第一行仍是"审查了/验证了/我们做了"，说明写成了过程，重写。
4. **读者下一步动作**：读完要他去做什么（合/不合/改哪里/等谁）。

判断消息类型与正文形态：见 [references/message-shapes.md](references/message-shapes.md)。

## 正文契约：发结果，不发生产结果的过程

默认正文顺序：**结论/变化 → 影响对象 → 需要谁做什么 → 必要链接。**

- 只保留足以支持行动的关键理由。**工具名、模型名、审查方法、运行过的命令、测试数量、已排除的误报、完整验证清单、审查者自评，默认不发**。用户明确要求报告过程时才加入。
- 测试失败若直接构成阻断，可作为一句证据；"所有测试都跑过"的过程清单不占消息主体。
- 内部代号、选项编号（A/B）、严重度（P0/P1）只有在接收者已共享该上下文且需要据此决策时才保留；否则展开成直接动作。
- 默认不用 emoji、连续粗体小标题、水平分隔线、"总评/验证/已核实为误报"专段和礼貌性夸奖。格式服务扫描，不替代判断。
- 不设僵硬字数门槛，以"删掉后是否影响读者行动"为取舍标准。复杂细节放 PR 评论或文档，群消息给链接。

## 内容闸门（prepare 之前必过）

正文未过以下检查，不得 `prepare`。这里是**语义检查**；脚本的 `dry-run` 仍只负责请求形状和安全，两件事互不替代。

- 第一行是结论吗？（不是"我审查了/验证了"）
- 明确说了能合 / 不能合 / 需谁处理吗？
- 混入生产过程的工具名、模型名、测试清单、误报澄清了吗？
- 出现接收者不懂的编号或术语了吗？（有就展开）
- 有无关的总评/自评/升华吗？
- 删掉一半，读者的行动会损失吗？不会就删。

## 改稿与确认

- 首次生成后先过内容闸门，再 `prepare`。
- 用户拒绝已 `prepare` 的正文并进入连续改稿时，旧计划**永不 commit**；先在草稿阶段完成措辞迭代，**不要每改一个词就 prepare 一次**。用户表示正文定稿后，才创建一个新计划。
- 新计划 dry-run 后仍需给一次最终确认——不能把定稿前的"就这样发"当作最终确认，这是保留安全边界所需的一次重复。
- 最终确认只重复**目标名称 + 完整正文**，不重复技术元数据（见下节确认模板）。

## 先收齐输入

开始任何 CLI 调用前，确定：

- 目标群名或 `oc_xxx`；
- 完整消息正文（已过内容闸门）；
- 身份（两层决策，详见 [references/identities.md](references/identities.md)）：
  - **profile**：由操作者明确选择，并在每次调用中显式传入 `--profile`；绝不按项目名、当前 active profile 或本地记录猜测。
  - **bot/user 类型**：由用户要求和当前 profile 的已验证权限决定；不试探性切换身份。
  - 人格：只有操作者已配置某个可公开的 persona skill 时才加载；人格不能覆盖结论、授权或确认门槛。
- 若为 Gitea PR review：PR URL 或 `owner/repo#N`，以及用户要求的 review 重点。

缺多项时一次问齐，不逐项追问。用户已经给出的 review 重点直接使用，不重复询问，不编造缺失重点。

## skill 路径约定

本文中的 `scripts/...`、`references/...` 均以当前 `SKILL.md` 所在目录为 skill 根目录。调用脚本前，用 `skill://feishu-im-send/scripts/feishu-send` 内部 URL 解析为实际文件路径（宿主自动解析到 FS 路径），再通过工具 env 传为 `SCRIPT`。`SCRIPT` 不是预置 shell 变量，也不得从 `$PWD`、HOME 扫描或固定安装目录猜测。

## 接收方定位：一次调用后必须停止或继续，禁止搜索循环

搜索和发送必须使用同一个 `--as user|bot`。不要为 user 发送去搜 bot 的接收方，反之亦然。

### 发给个人（`ou_xxx` 或姓名）

用户明确要发私聊，或给了 `ou_xxx`：
- 给了 `ou_xxx`：用 `+get-user` 校验并取得姓名（`USER` 走环境变量）。
- 只给姓名：用 `lark-cli contact +search-user --query "<姓名>" --as user` 搜出 `ou_xxx`，列出候选让用户选（可能同名）。

### 用户给了 `oc_xxx`（群）

用 `feishu-send prepare` 内部校验（脚本用 argv 传参，用户输入不进 shell 源码），无需手写 `chats get`：

```bash
SCRIPT=$(readlink -f "skill://feishu-im-send/scripts/feishu-send")
printf '%s' "$MSG" | "$SCRIPT" prepare --chat-id '<oc_xxx>' --identity user --profile '<explicit-profile>' --content-format markdown
```

`prepare` 内部会 `chats get` 校验 `chat_status == "normal"` 并捕获群名；失败原样报错，不猜群。

### 用户给了群名

只按群名搜索发送身份已经加入、因而可能发送的群。**搜索关键词走环境变量，禁止用文本替换拼进命令**：

```bash
# 群名经 bash 工具的 env 参数传入（如 env: {GROUP: "..."}），命令只引用 "$GROUP"；
# 不要用文本替换拼进 --query 源码
lark-cli im +chat-search --query "$GROUP" \
  --disable-search-by-user \
  --search-types private,public_joined,external \
  --page-size 100 \
  --as '<user|bot>' \
  --format json
```

只运行这一次，然后按结果处理：

- **一个结果且名称与用户输入完全相同**：继续起草和 dry-run。
- **多个结果，或唯一结果只是模糊匹配**：列出 `name + chat_id`，让用户选；本轮停止，不 dry-run。
- **零结果**：说明该身份下未找到，让用户补准确群名或 `chat_id`；本轮停止。

禁止自动换关键词、拆词、试大小写、切 user/bot、改用 `chat-list` 兜底或自动拿第一条。

只有用户明确说"不记得群名，请列出/浏览我的群"时，才运行一次：

```bash
LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 \
  lark-cli im +chat-list \
  --sort active_time --page-size 100 --as '<user|bot>' \
  --jq '.data | {chats:(.chats | map({name,chat_id,external,chat_mode,chat_status})),has_more,page_token}'
```

展示首屏供用户选择；不要自动翻页，除非用户要求更多。

## 一次写对正文（安全第一：正文绝不进 shell 源码）

**任何用户提供的文本（正文、群名、chat_id、PR 标题）都禁止通过文本替换嵌入 shell 命令源码**——`$(...)`、反引号、`$VAR`、单引号都会被 shell 解释。**正确做法只有两种**，不要用 `export MSG='...'` 之类赋值拼接：

1. **有脚本路径（推荐）**：正文走 stdin 交给 `feishu-send`：
   ```bash
   SCRIPT=$(readlink -f "skill://feishu-im-send/scripts/feishu-send")
   printf '%s' "$MSG" | "$SCRIPT" prepare --chat-id "$CHAT" --identity user --profile "$PROFILE" --content-format markdown
   ```
   `$MSG` 来自 bash 工具的 env 参数（不是 shell 赋值），脚本用 argv 数组转发，正文绝不被 shell 解释。

2. **无脚本路径**：正文放 bash 工具的 **env 参数**（`env: {MSG: "..."}`），命令只引用 `"$MSG"`：
   ```bash
   lark-cli im +messages-send --chat-id "$CHAT" --as user --markdown "$MSG" --dry-run
   ```
   工具 env 传参时 shell 不解析内容；禁止先用 `export MSG='<含引号/特殊字符的正文>'` 赋值再引用。

- 格式：标题/列表/链接/摘要/通知用 `--markdown`；日志/代码/缩进/字面 Markdown/精确纯文本用 `--text`。
- 多行正文：env 参数里放真实换行，或脚本路径走 stdin（推荐，天然保留换行）。

禁止（都会导致格式失效或注入）：

- `--markdown "a\nb"`：bash 双引号不会把 `\n` 变成换行；
- `--markdown $MSG`：会发生分词；
- `export MSG='<用户正文>'` 或 `export CHAT='<用户输入>'` 后用：用户文本含单引号即闭合注入；
- 把正文/群名/chat_id 直接写进任何 shell 引号内。

飞书 Markdown 不是完整 GFM；不要发复杂表格或 HTML。`@张三` 不会产生 mention；需要 mention 时先用 `lark-cli contact`（或既有 reference）把姓名解析成 `ou_xxx`，再用 `<at user_id="ou_xxx">张三</at>`。

## 生成不可变计划并 dry-run（用 feishu-send 脚本）

接收方确定唯一 `chat_id`（群）或 `user_id`（人）后，用 `feishu-send` 脚本（在 skill 目录 `scripts/feishu-send`）完成机械流程：校验接收方、冻结 payload、生成 UUID、dry-run、原子保存计划。**正文走 stdin，不进 shell 源码，杜绝注入。**

```bash
SCRIPT=$(readlink -f "skill://feishu-im-send/scripts/feishu-send")
# 发群：--chat-id
printf '%s' "$MSG" | "$SCRIPT" prepare \
  --chat-id "$CHAT" --identity user --profile "$PROFILE" --content-format markdown --output json
# 发个人（私聊）：--user-id
printf '%s' "$MSG" | "$SCRIPT" prepare \
  --user-id "$USER_ID" --identity user --profile "$PROFILE" --content-format markdown --output json
```

`prepare` 返回 `plan_id` + `confirmation_digest` + 完整冻结计划（receiver/identity/profile/format/content/idempotency_key）。显式传入的 `--profile` 会冻结进计划，`commit` 自动复用。若失败（接收方无效/非 normal/dry-run 错），原样报告，不猜。

执行 prepare 后，在同一回复中展示**用户可决策的信息**并请确认：

```text
目标：<群名或个人名>
（仅当非默认 bot 身份、即用 user 身份时追加：将以本人身份发送）
正文：
<完整最终正文>

回复"发送"确认。
```

- 约定的默认身份、`markdown/text`、`plan_id`、`confirmation_digest`、`idempotency_key`、`TTL`、`profile` **不展示**——它们留在工具状态里，对用户判断"要不要发"没有决策价值。
- 只有接收方仅靠 ID 才能区分时，才附 ID；已经通过群名消歧后不重复协议细节。
- **最终完整正文必须完整展示**，不能为了短而牺牲知情确认。内容的 verbatim 冻结与 digest 校验继续照旧由脚本保证。

**脚本边界**：脚本不选接收方、不改正文、不判格式、不判确认——这些是 LLM 决策。脚本只保证"已解析计划被原样且至多一次提交"。

## 发送门闩

消息会被第三方看到，最终计划形成后必须取得用户明确确认。用户在看到计划前说过"直接发""不用确认""你看着发"，不能替代这次确认。

- 未明确确认：不发送。
- 用户只要求预览/走到确认：停在这里。
- 用户修改接收方、身份、格式或正文：重新 `prepare`（新计划新 UUID），重新确认。
- 用户确认后，用 `plan_id` + `confirmation_digest` 提交（脚本校验 digest，防引用错计划）：

```bash
"$SCRIPT" commit --plan-id "$PLAN_ID" --expect-digest "$DIGEST" --output json
```

- 脚本内部：同一幂等键、三条件成功判定（退出码 0 + `ok==true` + 非空 `data.message_id`）、超时未知状态最多自动重试一次、sent 状态幂等回放。
- **绝不**在 commit 时重拼正文/换身份/换接收方——脚本只读冻结计划。
- 用户要求再发一条相同消息：新 prepare 新计划新 UUID，重新确认。

## 加急（urgent）

对已发出的消息追加强提醒（弹窗 + 加急专用提示音）。用户要求"加急"时：发送必须走 `--identity bot`（只能加急机器人自己发的消息），commit 拿到 `message_id` 后立刻：

```bash
lark-cli im messages urgent_app --message-id "$MID" --user-id-type open_id \
  --data '{"user_id_list":["ou_xxx"]}' --as bot --profile "$PROFILE" --format json
```

流程、限制、排错见 [references/urgent-messages.md](references/urgent-messages.md)；加急对象的 open_id 按 profile 查 [identities.md](identities.md) 的映射。要点：

- 应用需已开通 `im:message.urgent` **且发版生效**；报 `99991672` 即权限未生效。
- `urgent_sms`/`urgent_phone` 消耗企业额度，仅在用户点名时用。

## 纠错消息

当新消息推翻/更正之前发过的一条消息时：

- 第一句直接**道歉并指出上一条哪项结论有误**。
- 第二句给**正确结论和受影响动作**。
- 需要时补一句如何处置旧消息；**发现过程、辩解和长篇复盘默认不发**。

推荐形态：

```text
抱歉，上一条关于 <事项> 的结论有误。正确结论是 <结论>。请 <动作>。
```

若上一条里出现过类似"倾向 A/B"这类不成熟建议，直接说明"之前倾向的修法是错的，正确做法是 X"，不展开为何之前错了。

## Gitea PR review 请求

仅在用户要请人 review Gitea PR 时读取 [references/gitea-pr-review.md](references/gitea-pr-review.md)，拉取 PR 元数据和填好正文后，仍走本文同一条群定位、dry-run、确认、幂等发送路径；不另开发送口。

**区分**：请人 review 用 `gitea-pr-review.md` 的邀请模板；发"已完成的 review 结论"是结果通知，用 [references/message-shapes.md](references/message-shapes.md) 的结果消息形态，复用邀请模板会导致把 PR 元数据当正文发出去。

## 失败处理

遇到认证、scope、profile 或 `Bot/User can NOT be out of the chat` 时，读取 [references/troubleshooting.md](references/troubleshooting.md)，只处理已发生的错误。不要预先探测，不要自动切 profile 或身份，不要用另一身份硬发。

profile、租户和 ID 的边界见 [references/identities.md](references/identities.md)。公开版不携带任何本地 profile、用户或群组映射；操作者须在自己的安全配置中维护它们。

禁止输出 token、`Authorization` header，禁止 `-v`、`--trace`、`set -x`。错误时保留结构化 stderr 中的 `error.message`、`hint`、`permission_violations` 和 `console_url`，但不泄露凭据。
