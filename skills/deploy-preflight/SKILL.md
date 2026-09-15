---
name: deploy-preflight
description: 通用部署预检、SSH 通道修复、备份流式验证、可逆生产冒烟与回流合并检查。任何涉及远程服务器发版、rollback、生产数据写入验证的任务在动手前使用；项目专用命令以仓库内 deploy 技能/runbook 为准。
---

# 部署预检与安全运维（通用）

本技能只放**与具体项目无关**的可复用配方；项目专用主机、分支、脚本、表名一律以各仓库的 deploy 技能和 runbook 为准。

## 1. 铁律

- 远程变更执行前核对授权是否覆盖目标、环境及副作用。同一次已批准操作中明确包含的步骤不重复索取授权；新的发布、目标变化或未覆盖的恢复／数据操作另行请求批准。
- 预检失败（证书、磁盘、DB、阻塞订单、git 访问）不可 confirm 绕过。
- 全程分阶段汇报；停机窗口开始必须立刻告知用户。
- 生产验证（smoke）必须可逆：先快照，再写入，验证后精确还原，并复核前后计数一致。
- 不在生产跑测试/覆盖率；只用生产真实路径做最小写入。

## 2. SSH 通道预检与长连接（通用）

**先分别验证三类通道，一个 `ssh` 通不代表 `scp`/`git fetch` 通。**

症状 1：`Bad owner or permissions on /etc/ssh/ssh_config.d/...` → 系统 ssh 配置损坏。无 root 时绕过系统配置：

```bash
ssh -F "$HOME/.ssh/config" -o ControlMaster=no -o ControlPath=none <HOST> echo ok
```

症状 2：`unix_listener: cannot bind to path ... Read-only file system` → ControlPath 目录只读/不可写。用 `ControlMaster=no -o ControlPath=none`，或把 ControlPath 指到可写目录（`/tmp`）。

长连接 wrapper（只服务单一目标主机）：

```bash
mkdir -p /tmp/ssh-wrap /tmp/ssh-ctl && chmod 700 /tmp/ssh-ctl
cat > /tmp/ssh-wrap/ssh <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/ssh -F "$HOME/.ssh/config" \
  -o ControlMaster=auto -o ControlPath=/tmp/ssh-ctl/<HOST> "$@"
EOF
# scp 同理，/usr/bin/scp 支持 -F/-o
```

**关键坑**：wrapper 写死后只服务一个目标。给 git 用 SSH 时绝不能复用该 wrapper，否则 GitHub 流量会误入服务器 master socket（症状：`'<org>/<repo>.git' does not appear to be a git repository`）。git 通道单独用：

```bash
export GIT_SSH_COMMAND='/usr/bin/ssh -F '"$HOME"'/.ssh/config -o ControlMaster=no -o ControlPath=none'
```

预检三连（都要成功）：

```bash
ssh <HOST> echo ok          # 控制通道
scp <本地小文件> <HOST>:/tmp/  # 文件通道（用完删除远端临时文件）
GIT_SSH_COMMAND=... git fetch origin <branch>  # 代码通道
```

## 3. 部署工作区（通用）

- **永远不用共享主 worktree 部署**：它可能被其他会话切分支、改文件。为每次部署建专用 worktree，并在 build/launch 前加守卫：

```bash
[ "$(git branch --show-current)" = "<DEPLOY_BRANCH>" ] && \
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/<DEPLOY_BRANCH>)" ] || exit 1
```

- 后台任务必须显式传 `workdir`；dry-run 输出先确认 `HEAD/分支` 再继续。
- 构建上下文卫生：`.env`、未跟踪目录、密钥文件必须先移出 Docker build context；检查镜像 `ls /app/.env` 应不存在。

## 4. 备份验证（通用，不额外占盘）

全量备份前先做流式验证；真正发版时再由部署脚本落正式备份。

```bash
# 旧备份完整性
gzip -t <media_backup.tar.gz>
grep -c "PostgreSQL database dump complete" <db_backup.sql>

# 当前备份路径可用（只读/不落盘）
pg_dump <db_args> > /dev/null && echo "fresh pg_dump OK"
tar czf - -C <media_dir> . | wc -c   # 输出字节数即通读成功
```

记住三件事：备份文件可能由 docker 以 root 属主生成（恢复时注意权限）；保留策略可能删除你“以为可依赖”的旧备份；当前运行 HEAD 若无 tag，回滚前先打 recovery tag。

## 5. 可逆生产冒烟（通用模式）

适用：必须在生产验证某个写路径，又不想留测试痕迹。

1. **快照**：目标主键 + 受影响表的行数/关键字段，落到服务器临时 JSON。
2. **真实路径触发**：走真实 API/业务入口（可临时 mint 管理员 JWT），不绕过权限。
3. **验证产物**：拉回 PDF/文件做像素级或内容级校验。
4. **精确还原**：删除本次产生的子表行与 media 文件，再按快照还原主表字段；注意 `auto_now` 字段是否被 `update_fields` 漏更新。
5. **复核**：状态计数、文件列表与快照前逐项一致；清理所有临时文件。

只有单人/低流量窗口可用；有任何并发写入可能时不要用，改走专用测试环境。

## 6. GitHub 访问诊断（通用）

- SSH `git ls-remote` 报 `Repository not found` 多半是**没有权限**，不是仓库不存在。先看 deploy key 状态：

```bash
gh api repos/<owner>/<repo>/keys --jq '.[] | {title, enabled, read_only}'
```

- `enabled:false` 常见根因：org「Settings → Member privileges → Deploy keys」被设为 Disabled（该开关没有公开 API，只能网页开）；开启后无需重加 key。
- 服务器 `origin` 可能是旧 owner 名（GitHub 重定向可通）；仍应 `git remote set-url` 成规范地址并 `ls-remote` 验证。
- 本机 `gh` 不能 approve 自己账号的 PR，可用 COMMENT review + 说明；仓库无分支保护时按项目规则决定 merge。
- `gh pr merge --delete-branch` 在本地分支被 worktree 占用时会失败（远端分支也没删），合并状态单独查 `gh pr view <n> --json state,mergedAt`，远端分支手动清理。

## 7. 回流/合并检查（通用）

- `git merge-tree` 给出的冲突文件数 ≠ 全部冲突：**自动合并的文件可能有语义冲突**（典型：多租户分支多了必填字段、单租户分支的测试没带该字段）。解完冲突必须实跑测试。
- 合并用 PR head SHA，不要盲推本地分支（本地可能有多余未推送 commit）。
- 回流后校验不变量（如 `git rev-list --count main..production` 应为 0 或按项目规则）。

## 8. 非交互执行（通用）

- 交互式部署脚本在无 TTY 下 `confirm` 通常 fail-closed；用 `-y`/`FORCE` 前必须用户明确授权，且确认其**不绕过硬门禁**。
- 长任务放后台 + 轮询输出，按阶段向用户汇报，禁止静默跑完。

## 9. 最小检查清单

```
[ ] ssh / scp / git fetch 三通道分别通过
[ ] 专用 worktree + 分支守卫通过
[ ] 服务器 git origin 规范且 ls-remote 目标分支成功（deploy key enabled）
[ ] 服务器端部署脚本与本地一致（缺子命令先 sync）
[ ] 阻塞订单/预检门禁通过
[ ] 备份流式验证通过；磁盘余量 ≥ 2× 备份+镜像包
[ ] 构建上下文无 .env / 未跟踪垃圾；镜像内无 .env
[ ] 冒烟方案可逆（有快照与还原步骤）
[ ] 回流冲突已解且测试通过
```
