# 加急消息（urgent）

对**已发出**的消息追加强提醒。仅用户明确要求加急时使用；短信/电话加急消耗企业额度，须用户点名。

## 前提（缺一即失败）

1. 发送必须 bot 身份：飞书只允许加急机器人自己发的消息。
2. 应用已开通 `im:message.urgent`（或旧版 `im:message.urgent:app_send`）**且发版生效**；报 `99991672` 即权限未生效（按报错链接申请 + 发版）。
3. 加急目标用户在消息所属会话内。

## 流程

按 SKILL.md 的正常流程发送（`--identity bot` 和显式 `--profile`），`commit` 拿到 `message_id` 后立即：

```bash
LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 \
lark-cli im messages urgent_app \
  --message-id "<om_xxx>" \
  --user-id-type open_id \
  --data '{"user_id_list":["<ou_xxx>"]}' \
  --as bot --profile "<profile>" --format json
```

- 三种方式命令同形：`urgent_app`（应用内强提醒弹窗 + 加急专用提示音）、`urgent_sms`（再加急 + 短信）、`urgent_phone`（再加急 + 真实来电，语音播报"机器人给你发了一条加急消息"）。
- `user_id_list` 必须是**发送应用自己视角的 open_id**，按 [identities.md](identities.md) 的映射取，没有就先反查。
- 成功判定：退出码 0 + `ok == true`；`invalid_user_id_list` 为空即全部生效。
- 电话加急 API 成功但用户没接到电话：先查手机**拦截记录**（飞书固定号码外呼，常被当骚扰拦截；官方建议把飞书"消息通知"设置里的加急电话号码存入通讯录），其次查账号是否绑定手机号、租户是否启用电话加急。

## 限制

- 只能加急 bot 自己发的、未删除、未聚合、非批量（`bm_` 前缀）的消息。
- `user_id_list` ≤ 200；频控 1000 次/分钟、50 次/秒。
- 接收人未读加急超过 200 条时对其加急失败（`230023`/`230024`）；点掉弹窗不算已读，须进会话真正读到消息。
