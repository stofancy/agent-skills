#!/usr/bin/env bash
# 发布前脱敏检查：本仓库是公开的，提交前必须跑一遍。
#
#   scripts/leak-check.sh            # 检查工作区（默认）
#   scripts/leak-check.sh <rev>      # 检查某个提交，例如 scripts/leak-check.sh HEAD~1
#
# 命中任何一条即退出码 1，并把命中的行打出来。模式按需在此文件里扩充：
# 只写"不该出现在公开仓库里的东西"——组织/项目标识、内部服务名、本地绝对路径、
# 私有知识库路径、真实工单号与测试计数、凭据与身份。
set -uo pipefail

REV="${1:-}"
PATTERNS=(
  # 组织与项目（按你的环境替换/扩充）
  'serko' 'eos[-_a-z]' 'cnp-' 'salesservice' '\bsss\b' '\bpcb\b' '\bb4b\b'
  'booking\.com' 'heritagecorporate' 'tokenex' 'adyen' 'newrelic' 'sumo logic'
  'dev\.azure' 'atlassian\.net' 'jira/[a-z]'
  # 内部运行痕迹与本地路径
  '/home/[a-z]' '~\.[a-z]' 'review-reports' 'agent-shared' 'workspaces/'
  '\bomp\b' 'claude/skills' 'managed-skills'
  # 真实工单号与"我跑过"的原始数字（工单用 <TICKET> 之类占位符，测试计数不写具体值）
  '[A-Z]{2,6}-[0-9]{2,5}' '\b([0-9]{2,4})/\1\b'
  # 私有知识库/本地配置的相对路径
  'env/[a-z-]+\.md'
  # 凭据与身份
  'xox[bp]-' 'ghp_' 'github_pat' 'AKIA[0-9A-Z]{16}' 'BEGIN [A-Z ]*PRIVATE KEY'
  '@[a-z0-9.-]+\.(com|net|io|dev)' 'U0[A-Z0-9]{8}' 'D0[A-Z0-9]{8}'
)

if [ -n "$REV" ]; then
  hits=$(git grep -niE "$(IFS='|'; echo "${PATTERNS[*]}")" "$REV" -- '*.md' '*.mjs' '*.py' '*.json' '*.sh' 2>/dev/null | \
         grep -vE 'assets/.*\.(woff2|png)$' | grep -v 'scripts/leak-check.sh' || true)
  where="提交 $REV"
else
  hits=$(grep -rniE "$(IFS='|'; echo "${PATTERNS[*]}")" . \
         --include='*.md' --include='*.mjs' --include='*.py' --include='*.json' --include='*.sh' 2>/dev/null | grep -v 'scripts/leak-check.sh' || true)
  where="工作区"
fi

if [ -n "$hits" ]; then
  echo "FAIL：$where 命中 $(printf '%s\n' "$hits" | wc -l | tr -d ' ') 行疑似泄漏：" >&2
  printf '%s\n' "$hits" | head -40 >&2
  echo "逐条判断：能改写成通用表述的就改写；确实必须保留的，用占位符（<TICKET-123>）或删除。" >&2
  exit 1
fi
echo "OK：$where 未命中 $((${#PATTERNS[@]})) 条模式。"
