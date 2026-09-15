# Gitea PR review 请求（仅用户要请人 review 时读）

**本文件只负责"请别人 review 一个 PR"（邀请）。** 如果要发的是"已经完成的 review 结论"（即你审完了，要把结论发群），走主 skill 的"结果通知"形态，**不要复用本文件的邀请模板**——邀请模板带 PR 元数据 + review 重点，结论消息只需要"合/不合 + 阻断 + 动作"，见 [message-shapes.md](message-shapes.md)。

拉取 PR 元数据、填好正文后，走 SKILL.md 的同一条群定位 → dry-run → 确认 → 幂等发送路径。不另开发送口。

## 解析 PR
从输入提取 owner/repo/number（URL 或 `org/repo#N`）。

## 凭据获取（统一到 `CRED_TOKEN` + `GITEA_BASE_URL` 两个变量）

按优先级获取，**无论走哪条，最终都赋给 `CRED_TOKEN` 和 `GITEA_BASE_URL`**（下面的 curl 统一用这两个变量）：

1. **显式环境变量**：
   ```bash
   if [ -n "$GITEA_TOKEN" ] && [ -n "$GITEA_BASE_URL" ]; then
     CRED_TOKEN="$GITEA_TOKEN"
   fi
   ```
2. **`git credential fill`**（让 Git 访问系统 credential helper，兼容 keychain/libsecret/manager/store，不直接读文件）：
   ```bash
   if [ -z "$CRED_TOKEN" ] && [ -n "$GITEA_BASE_URL" ]; then
     HOST=$(printf '%s' "$GITEA_BASE_URL" | sed -E 's#^https?://([^/]+).*#\1#')
     CRED=$(printf 'protocol=https\nhost=%s\n\n' "$HOST" | git credential fill 2>/dev/null | grep '^password=')
     CRED_TOKEN=${CRED#password=}
   fi
   ```
   `git credential fill` 输出含 `password=` 行；只取该值，**不打印完整输出**（可能含凭据）。

**校验**：若 `CRED_TOKEN` 为空或 `GITEA_BASE_URL` 为空，报告缺前置条件并停，**不要编造 PR 元数据**。PR URL 的 host 必须与取凭据的 host 完全一致、仅允许 HTTPS。凭据属于用户/系统状态，绝不复制进 skill 目录或示例配置。

## 拉 PR 信息（校验 HTTP 成功与必需字段，杜绝伪元数据）
```bash
set -o pipefail
curl --fail-with-body -sS \
  -H "Authorization: token $CRED_TOKEN" \
  "$GITEA_BASE_URL/api/v1/repos/<owner>/<repo>/pulls/<N>" \
  | jq -e 'select(.number != null and .title != null and .base != null and .head != null and .html_url != null) | {number,title,base:.base.ref,head:.head.ref,additions,deletions,changed_files,html_url}' \
  || { echo "PR 元数据拉取失败（HTTP 非 2xx、JSON 无效或必需字段缺失）"; exit 1; }
```
- `set -o pipefail`：curl 的 401/403/404 非零退出码**不会被末端 jq 吞掉**——管道整体失败。
- `--fail-with-body`：HTTP 错误时 curl 返回非零。
- `jq -e ... select(...)`：**必需字段（number/title/base/head/html_url）缺失时 jq 退出非零**，不会用 `null` 填充。
- 禁止把 token 打进对话、禁止 `-v`/`--trace`/`set -x`（token 已放环境变量，不进 argv）。

## 填模板
```
【${TITLE} #${N} 求 review】
基于 ${BASE} ← ${HEAD}
📎 ${HTML_URL}
规模：${CHANGED_FILES} 文件 +${ADD}/-${DEL}
请重点看：
- ${POINT_1}
- ${POINT_2}
意见直接打在 PR 里即可，谢谢。
```
- "不 merge，只看 diff"：**仅当用户明确要求**才加这行。"review"本身不自动等价于"禁止 merge"。
- review 重点：用户已给就直接用，拆成列表；只有完全缺失时才和其他缺项一次询问，不编造。
- 链接和 chat 身份不得截断；只截断摘要/重点列表。

## 发送
走 SKILL.md 的不可变计划：群定位 → dry-run → 用户确认 → 同一幂等键发送。
