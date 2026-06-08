/**
 * IssueDetail — Issue 详情 + 对话页
 *
 * 灵感来源 Linear 的 issue detail view：
 * 左侧元信息 + 右侧对话流（消息 + 事件）
 */

import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type IssueStatus } from "@/components/ui/status-badge";
import { PriorityIndicator } from "@/components/ui/priority";
import { Avatar } from "@/components/ui/avatar";
import type { MessageRole, MessageEventKind, ConversationKind } from "@/conversation/types.js";

// ─── 类型 ───────────────────────────────────────────────

interface MockMessage {
  id: number;
  from_role: string;
  role: MessageRole;
  status: "completed" | "streaming" | "failed";
  created_at: string;
  events: MockEvent[];
}

interface MockEvent {
  id: number;
  kind: MessageEventKind;
  payload: unknown;
  created_at: string;
}

interface MockConversation {
  id: string;
  title: string;
  kind: ConversationKind;
  status: string;
  stageTitle: string;
  messages: MockMessage[];
}

// ─── 模拟数据 ───────────────────────────────────────────

const mockIssue = {
  id: "iss-001",
  issueNumber: "SS-142",
  title: "优化 Agent 上下文窗口管理",
  summary: "当前上下文截断策略过于简单，需要智能摘要机制。当对话历史超过 token 限制时，当前方案直接截断最早的上下文，导致重要的前置信息丢失，影响 Agent 决策质量。",
  status: "in_progress" as IssueStatus,
  priority: "high" as const,
  assignees: ["Agent-Arch", "Dev-Lead"],
  labels: ["architecture", "performance"],
  sopName: "Feature Development SOP",
  currentStage: "设计阶段",
  createdAt: "2026-06-07T10:00:00Z",
  updatedAt: "2026-06-08T08:30:00Z",
  taskAnchor: {
    goal: "实现基于重要性评分的智能上下文摘要机制",
    anti_goals: ["不做完全的重新设计", "不引入外部 LLM 依赖"],
    constraints: ["兼容现有消息格式", "P99 延迟 < 50ms"],
  },
};

const mockConversations: MockConversation[] = [
  {
    id: "conv-001",
    title: "设计方案讨论",
    kind: "design",
    status: "active",
    stageTitle: "设计阶段",
    messages: [
      {
        id: 1, from_role: "product-owner", role: "user", status: "completed",
        created_at: "2026-06-07T10:05:00Z",
        events: [
          { id: 1, kind: "text", payload: { text: "我们需要一个更好的上下文管理策略。当前方案在长对话场景下表现很差，Agent 经常忘记早期的约束条件。" }, created_at: "2026-06-07T10:05:00Z" },
        ],
      },
      {
        id: 2, from_role: "agent-arch", role: "assistant", status: "completed",
        created_at: "2026-06-07T10:06:00Z",
        events: [
          { id: 2, kind: "start", payload: { runtime: "llm", session_id: "sess-abc" }, created_at: "2026-06-07T10:06:00Z" },
          { id: 3, kind: "text", payload: { text: "收到。我分析了当前的上下文截断逻辑，主要问题在于：\n\n1. **FIFO 截断**：最早的消息被直接丢弃，但往往包含重要的需求约束\n2. **无摘要机制**：被截断的内容没有被压缩保留\n3. **缺少重要性标记**：所有消息被视为等权重\n\n我建议引入 **Importance-Weighted Context Window** 方案。" }, created_at: "2026-06-07T10:06:30Z" },
          { id: 4, kind: "tool_call", payload: { tool_name: "search_code", tool_call_id: "tc-001", arguments: { query: "context window truncation" } }, created_at: "2026-06-07T10:07:00Z" },
          { id: 5, kind: "tool_result", payload: { tool_call_id: "tc-001", result: { files: ["src/conversation/_internal/context-manager.ts", "src/snail/acs/context.ts"] } }, created_at: "2026-06-07T10:07:05Z" },
          { id: 6, kind: "text", payload: { text: "找到了相关代码。当前实现在 `context-manager.ts` 中，使用的是简单的 FIFO 策略。" }, created_at: "2026-06-07T10:07:10Z" },
        ],
      },
      {
        id: 3, from_role: "dev-lead", role: "user", status: "completed",
        created_at: "2026-06-07T10:10:00Z",
        events: [
          { id: 7, kind: "text", payload: { text: "方案方向认同。但需要考虑性能影响，摘要计算不能阻塞消息流。P99 延迟控制在 50ms 以内。" }, created_at: "2026-06-07T10:10:00Z" },
        ],
      },
      {
        id: 4, from_role: "agent-arch", role: "assistant", status: "completed",
        created_at: "2026-06-07T10:12:00Z",
        events: [
          { id: 8, kind: "text", payload: { text: "明白。我的方案细节：\n\n### 架构\n\n```\n┌─────────────┐    ┌──────────────┐    ┌─────────────┐\n│  Live Window │───→│  Importance  │───→│   Summary   │\n│  (recent N)  │    │  Scorer      │    │   Cache     │\n└─────────────┘    └──────────────┘    └─────────────┘\n```\n\n- **Live Window**：保留最近 N 条消息的完整内容\n- **Importance Scorer**：基于规则（系统消息 > 工具结果 > 用户指令 > 闲聊）打分\n- **Summary Cache**：异步生成摘要，缓存在内存中\n\n摘要计算完全异步，不阻塞消息处理主路径。" }, created_at: "2026-06-07T10:12:30Z" },
        ],
      },
      {
        id: 5, from_role: "product-owner", role: "user", status: "completed",
        created_at: "2026-06-07T10:15:00Z",
        events: [
          { id: 9, kind: "text", payload: { text: "看起来不错。anti-goal 确认：不引入外部 LLM 做摘要，用本地算法。另外要兼容现有的消息格式，不要改 schema。" }, created_at: "2026-06-07T10:15:00Z" },
        ],
      },
      {
        id: 6, from_role: "agent-arch", role: "assistant", status: "streaming",
        created_at: "2026-06-08T08:28:00Z",
        events: [
          { id: 10, kind: "text", payload: { text: "好的，我正在编写详细设计文档。基于以上讨论，核心设计点：\n\n1. 引入 `ImportanceScorer` 接口，支持规则扩展\n2. `ContextWindow` 管理器负责窗口滑动和摘要触发\n3. 摘要使用 TF-IDF 提取关键句，不依赖外部模型\n4. 异步摘要任务通过事件队列调度\n\n正在输出设计文档..." }, created_at: "2026-06-08T08:28:30Z" },
        ],
      },
    ],
  },
];

// ─── 主页面 ─────────────────────────────────────────────

export function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const [activeConvIdx, setActiveConvIdx] = useState(0);

  // 真实场景: const { data: issue } = useQuery(issueQueries.detail(issueId!));
  const issue = mockIssue;
  const conversations = mockConversations;
  const activeConv = conversations[activeConvIdx];

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="issue-detail">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
        <button
          onClick={() => navigate("/issues")}
          className="text-[var(--color-text-grey)] hover:text-[var(--color-text-primary)] transition-colors"
          title="Back to board"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-[11px] text-[var(--color-text-grey)] font-mono">{issue.issueNumber}</span>
        <span className="text-sm font-medium text-[var(--color-text-primary)] flex-1 min-w-0 truncate">
          {issue.title}
        </span>
        <StatusBadge status={issue.status} />
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Issue metadata */}
        <div className="w-[320px] shrink-0 border-r border-[var(--color-border-muted)] overflow-y-auto p-4 space-y-5">
          {/* Priority */}
          <MetaRow label="Priority">
            <div className="flex items-center gap-1.5">
              <PriorityIndicator priority={issue.priority} />
              <span className="text-xs text-[var(--color-text-primary)] capitalize">{issue.priority}</span>
            </div>
          </MetaRow>

          {/* Status */}
          <MetaRow label="Status">
            <StatusBadge status={issue.status} />
          </MetaRow>

          {/* Assignees */}
          <MetaRow label="Assignees">
            <div className="flex flex-wrap gap-1.5">
              {issue.assignees.map((a) => (
                <div key={a} className="flex items-center gap-1.5 bg-[var(--color-bg-elevated)] rounded-md px-2 py-1">
                  <Avatar name={a} size="sm" />
                  <span className="text-xs text-[var(--color-text-primary)]">{a}</span>
                </div>
              ))}
            </div>
          </MetaRow>

          {/* Labels */}
          <MetaRow label="Labels">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <Badge key={l} variant="outline" className="text-[10px] border-[var(--color-border-muted)] text-[var(--color-text-grey)]">
                  {l}
                </Badge>
              ))}
            </div>
          </MetaRow>

          {/* SOP */}
          <MetaRow label="SOP">
            <span className="text-xs text-[var(--color-text-secondary)]">{issue.sopName}</span>
          </MetaRow>

          {/* Current Stage */}
          <MetaRow label="Stage">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              <span className="text-xs text-[var(--color-text-primary)]">{issue.currentStage}</span>
            </div>
          </MetaRow>

          {/* Task Anchor */}
          <div className="pt-2 border-t border-[var(--color-border-muted)]">
            <div className="text-[11px] font-medium text-[var(--color-text-grey)] uppercase tracking-wider mb-2">
              Task Anchor
            </div>
            <div className="space-y-2">
              <div>
                <div className="text-[10px] text-[var(--color-text-grey)] mb-0.5">Goal</div>
                <div className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                  {issue.taskAnchor.goal}
                </div>
              </div>
              {issue.taskAnchor.anti_goals.length > 0 && (
                <div>
                  <div className="text-[10px] text-[var(--color-text-grey)] mb-0.5">Anti-goals</div>
                  <ul className="text-xs text-[var(--color-text-secondary)] space-y-0.5">
                    {issue.taskAnchor.anti_goals.map((ag, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-red-400 mt-0.5">×</span>
                        <span>{ag}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {issue.taskAnchor.constraints.length > 0 && (
                <div>
                  <div className="text-[10px] text-[var(--color-text-grey)] mb-0.5">Constraints</div>
                  <ul className="text-xs text-[var(--color-text-secondary)] space-y-0.5">
                    {issue.taskAnchor.constraints.map((c, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-amber-400 mt-0.5">◆</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Conversation */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Conversation tabs */}
          <div className="flex items-center gap-1 px-4 pt-2 border-b border-[var(--color-border-muted)] shrink-0">
            {conversations.map((conv, idx) => (
              <button
                key={conv.id}
                onClick={() => setActiveConvIdx(idx)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  idx === activeConvIdx
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-transparent text-[var(--color-text-grey)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <ConversationKindIcon kind={conv.kind} />
                  {conv.title}
                </div>
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
            {activeConv?.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-[var(--color-border-muted)] shrink-0">
            <div className="flex gap-2">
              <div className="flex-1 rounded-lg border border-[var(--color-border-muted)] bg-[var(--color-bg-surface)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]">
                <textarea
                  placeholder="Send a message..."
                  rows={2}
                  className="w-full resize-none bg-transparent px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-grey)] focus:outline-none"
                />
              </div>
              <Button size="sm" className="self-end h-8">
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 子组件 ─────────────────────────────────────────────

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-[var(--color-text-grey)] uppercase tracking-wider mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function ConversationKindIcon({ kind }: { kind: ConversationKind }) {
  const icons: Record<ConversationKind, string> = {
    discussion: "💬",
    planning: "📋",
    design: "🎨",
    implementation: "⚙️",
    review: "👁️",
    bugfix: "🐛",
  };
  return <span className="text-[10px]">{icons[kind]}</span>;
}

function MessageBubble({ message }: { message: MockMessage }) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";

  return (
    <div className={`flex gap-2.5 ${isUser ? "" : ""}`}>
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        <Avatar name={message.from_role} size="md" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            {formatRoleName(message.from_role)}
          </span>
          <span className="text-[10px] text-[var(--color-text-grey)]">
            {formatTime(message.created_at)}
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
              streaming
            </span>
          )}
          {message.status === "failed" && (
            <span className="text-[10px] text-red-400">failed</span>
          )}
        </div>

        {/* Events */}
        <div className="space-y-1.5">
          {message.events.map((evt) => (
            <EventBlock key={evt.id} event={evt} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EventBlock({ event }: { event: MockEvent }) {
  switch (event.kind) {
    case "text": {
      const text = (event.payload as { text: string }).text;
      return (
        <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
          <MarkdownText text={text} />
        </div>
      );
    }
    case "tool_call": {
      const p = event.payload as { tool_name: string; arguments?: unknown };
      return (
        <div className="flex items-center gap-2 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-muted)] px-2.5 py-1.5">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-[var(--color-text-grey)] shrink-0">
            <path d="M14 8L8 2L2 8L8 14L14 8Z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span className="text-[11px] font-mono text-[var(--color-accent)]">{p.tool_name}</span>
          {p.arguments && (
            <span className="text-[10px] text-[var(--color-text-grey)] truncate">
              {JSON.stringify(p.arguments).slice(0, 60)}
            </span>
          )}
        </div>
      );
    }
    case "tool_result": {
      const p = event.payload as { tool_call_id: string; result: unknown; is_error?: boolean };
      return (
        <div className={`rounded-md border px-2.5 py-1.5 text-[10px] font-mono ${
          p.is_error
            ? "bg-red-500/10 border-red-500/20 text-red-300"
            : "bg-[var(--color-bg-elevated)] border-[var(--color-border-muted)] text-[var(--color-text-grey)]"
        }`}>
          <span className="opacity-60">→</span> {JSON.stringify(p.result).slice(0, 100)}
        </div>
      );
    }
    case "start":
      return null;
    case "error": {
      const p = event.payload as { message: string; code?: string };
      return (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 text-[11px] text-red-300">
          Error{p.code ? ` [${p.code}]` : ""}: {p.message}
        </div>
      );
    }
    default:
      return null;
  }
}

// ─── 简易 Markdown 渲染 ─────────────────────────────────

function MarkdownText({ text }: { text: string }) {
  // 轻量 markdown：加粗、行内代码、代码块、列表
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith("```")) return null;
        if (line.startsWith("# ")) return <div key={i} className="text-[13px] font-semibold text-[var(--color-text-primary)] mt-2 mb-1">{line.slice(2)}</div>;
        if (line.startsWith("### ")) return <div key={i} className="text-[12px] font-semibold text-[var(--color-text-primary)] mt-2 mb-1">{line.slice(4)}</div>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} className="pl-3 before:content-['•'] before:mr-1.5 before:text-[var(--color-text-grey)]">{renderInline(line.slice(2))}</div>;
        if (line.match(/^\d+\. /)) return <div key={i} className="pl-3">{renderInline(line)}</div>;
        if (line.trim() === "") return <div key={i} className="h-2" />;
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode {
  // 简单处理 **bold** 和 `code`
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);

    let firstMatch: { index: number; type: "bold" | "code"; content: string } | null = null;

    if (boldMatch && boldMatch.index !== undefined) {
      firstMatch = { index: boldMatch.index, type: "bold", content: boldMatch[1] };
    }
    if (codeMatch && codeMatch.index !== undefined) {
      if (!firstMatch || codeMatch.index < firstMatch.index) {
        firstMatch = { index: codeMatch.index, type: "code", content: codeMatch[1] };
      }
    }

    if (!firstMatch) {
      parts.push(remaining);
      break;
    }

    if (firstMatch.index > 0) {
      parts.push(remaining.slice(0, firstMatch.index));
    }

    if (firstMatch.type === "bold") {
      parts.push(<strong key={key++} className="font-semibold text-[var(--color-text-primary)]">{firstMatch.content}</strong>);
    } else {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-accent)] text-[10px] font-mono">
          {firstMatch.content}
        </code>
      );
    }

    remaining = remaining.slice(firstMatch.index + (firstMatch.type === "bold" ? firstMatch.content.length + 4 : firstMatch.content.length + 2));
  }

  return <>{parts}</>;
}

// ─── 工具函数 ───────────────────────────────────────────

function formatRoleName(role: string): string {
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
