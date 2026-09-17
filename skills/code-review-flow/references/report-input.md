# 旧 JSON 输入契约（兼容入口）

新报告默认使用自由创作的 HTML/SVG，见 [authoring.md](authoring.md)。本契约仅供已有 `render-review.mjs` 调用使用，不是新报告必须遵循的结构。旧 JSON 的内容字段和命令保持兼容，视觉基础改为共享 CSS，不承诺旧像素布局不变。

所有正文值都是纯文本字符串；渲染器转义 HTML。链接只接受 HTTP(S) 或相对引用，其他协议退化为文字。下列顶层字段必需，空列表可用 `[]`；`sections` 至少一项。

| 字段 | 内容 |
|---|---|
| `meta` | `title`, `subtitle`, `date`, `decision`, `scope` 字符串；scope 写审查范围/快照 |
| `prs` | `{label, url, head?}` 列表；head 为审查提交，不猜当前状态 |
| `sources` | `{label, url}` 需求或契约来源列表 |
| `lead` | `text` 核心解释、`terms: [{name, meaning}]` 可选术语列表 |
| `sections` | `{title, paragraphs: string[]}` 列表，下列附加字段按需使用 |
| `closing` | `text` 结论、`actions: string[]` 必要行动、`boundary` 验证边界 |

章节附加字段：

- `id`: 可选锚点名。
- `diagram`: `{type: "branch", start, branches: [{title, text}], end, caption}`。只支持分支再汇合；字符串必填，branches 非空。没有适当关系时省略，不塞空图。
- `table`: `{headers: string[], rows: string[][]}`，每行列数必须一致。优先少量业务对照列，避免路径挤占正文。
- `note`: 一段辅助说明；重要判断应放正文。
- `evidence`: `[{label, url}]`，默认折叠。label 可包含固定提交下的文件位置、测试名称等。

数字、严重度、发现状态不由渲染器推断，写在对应正文或表格中。不要复制示例业务结论。以下为虚构示例，仅展示结构；章节可以只含段落，不要求每节都有图和表。

```json
{
  "meta": {
    "title": "停用账号后的访问控制",
    "subtitle": "示意报告：需求、实现与剩余缺口",
    "date": "示例日期",
    "decision": "示例：修复后再合入",
    "scope": "虚构示例，不代表真实 PR 或验证结果"
  },
  "prs": [],
  "sources": [],
  "lead": {
    "text": "目标是让停用立即生效。实现增加状态检查，但已有会话仍可能绕过检查。",
    "terms": []
  },
  "sections": [
    {
      "title": "状态检查需要覆盖两种入口",
      "paragraphs": ["示例需求同时约束新登录和已有会话。该示例改动仅在登录时读取账号状态。"],
      "diagram": {
        "type": "branch",
        "start": "已停用账号尝试访问",
        "branches": [
          {"title": "重新登录", "text": "读取状态，拒绝登录。"},
          {"title": "使用已有会话", "text": "示例实现只验证会话，遗漏账号状态。"}
        ],
        "end": "访问是否被拒绝取决于入口",
        "caption": "两条替代路径用于解释覆盖差异。"
      },
      "table": {
        "headers": ["场景", "期望", "示例实现"],
        "rows": [
          ["新登录", "拒绝", "拒绝"],
          ["已有会话", "拒绝", "仍可访问"]
        ]
      },
      "note": "真实报告需要绑定实际代码与验证证据。"
    }
  ],
  "closing": {
    "text": "示例结论：已有会话的检查缺失，尚未满足停用立即生效的要求。",
    "actions": ["在已有会话访问路径检查账号状态，并验证停用后的访问行为。"],
    "boundary": "以上均为虚构示例，未执行真实测试。"
  }
}
```
