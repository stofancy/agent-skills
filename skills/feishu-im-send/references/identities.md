# 飞书身份与 Profile 边界

## 公开版的配置规则

本 Skill 不包含 profile 名、应用 ID、用户 open_id、union_id、群 chat_id、默认接收方或租户路由。把这些值保留在各自的安全配置中，且不要提交进仓库。

- 每次 `lark-cli` 调用和 `feishu-send prepare` 都显式带 `--profile <your-profile>`；不依赖 active profile。
- `prepare` 会把 profile 冻结进计划，`commit` 自动复用。需要切换 active profile 只在操作者明确要求时执行。
- `--as bot` 或 `--as user` 必须由用户意图和该 profile 的已验证权限决定。认证失败时，报告错误；不要自动改 profile 或身份重试。
- `open_id` 只在单一应用内有效；`union_id` 和 `user_id` 的可见范围取决于租户与开发者关系。跨应用或跨租户时，重新解析当前 profile 视角的目标 ID。

## 安全解析

已知 ID 时，可在当前 profile 中先验证；只给名称而出现多个候选时必须让用户指认。

```bash
# 群成员中解析 open_id；群必须包含目标用户
lark-cli api GET /open-apis/im/v1/chats/<oc_xxx>/members \
  --params '{"page_size":100,"member_id_type":"open_id"}' \
  --as bot --profile "<your-profile>" --format json \
  --jq '.data.items | map({name,member_id})'
```

不要把运行时解析出的 ID、群成员清单或应用元数据写回 Skill 文件。群名命中多个候选时，让用户选择，不按相似度猜测。

## 人格与权限

- 若调用方选择了一个可公开的 persona skill，可在消息组织阶段加载它；人格不能改变接收方、身份或确认要求。
- 按实际错误信息申请所需 scope；不要预先探测、记录或公开任何凭据。
