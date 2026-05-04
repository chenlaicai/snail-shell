export function renderDispatchState(target, dispatchState, currentConversation, escapeHtml, options = {}) {
  target.innerHTML = "";
  const groups = dispatchState?.inbox_groups || [];
  if (options.mode === "board") {
    renderBusBoard(target, groups, currentConversation, escapeHtml);
    return;
  }
  renderDiagnosticList(target, groups, currentConversation, escapeHtml);
}

function renderBusBoard(target, groups, currentConversation, escapeHtml) {
  if (!currentConversation) {
    target.innerHTML = "";
    return;
  }
  const activeGroups = groups.filter((group) => group.status === "pending" || group.status === "claimed");
  const recentGroups = activeGroups.length ? activeGroups : groups.slice(-4);
  const summary = summarizeGroups(groups);
  target.innerHTML = `
    <div class="message-bus-board-header">
      <div>
        <div class="message-bus-board-kicker">消息总线</div>
        <div class="message-bus-board-title">生成和消费已解耦，Snail 从 inbox 自主读取</div>
      </div>
      <div class="message-bus-board-stats">
        <span>${summary.incoming} 入站</span>
        <span>${summary.running} 消费中</span>
        <span>${summary.completed} 完成</span>
      </div>
    </div>
    <div class="message-bus-lanes">
      ${recentGroups.length ? recentGroups.map((group) => renderBusLane(group, escapeHtml)).join("") : '<div class="message-bus-idle">当前没有流动中的投递</div>'}
    </div>
  `;
}

function renderBusLane(group, escapeHtml) {
  const status = describeDispatchStatus(group.status);
  const preview = latestPreview(group);
  const forcedCount = Number(group.forced_wrap_up_count || 0);
  const forcedChip = forcedCount > 0 ? `<span class="bus-chip forced">收口 ${forcedCount}</span>` : "";
  return `
    <article class="message-bus-lane ${escapeHtml(group.status || "unknown")}">
      <div class="bus-lane-route">
        <span class="bus-node source">${escapeHtml(preview.from)}</span>
        <span class="bus-pulse" aria-hidden="true"></span>
        <span class="bus-node target">${escapeHtml(group.to_snail || "未知 Snail")}</span>
      </div>
      <div class="bus-lane-body">
        <div class="bus-lane-title">${escapeHtml(status.label)}</div>
        <div class="bus-lane-meta">${escapeHtml(status.short)} · ${group.dispatch_ids.length} dispatch · ${group.message_ids.length} message</div>
        ${preview.text ? `<div class="bus-lane-preview">${escapeHtml(preview.text)}</div>` : ""}
      </div>
      <div class="bus-lane-chips">
        ${forcedChip}
        <span class="bus-chip">${escapeHtml(formatTime(group.latest_dispatch_at))}</span>
      </div>
    </article>
  `;
}

function renderDiagnosticList(target, groups, currentConversation, escapeHtml) {
  if (!currentConversation) {
    target.innerHTML = '<div class="empty-state">未选择对话</div>';
    return;
  }
  if (!groups.length) {
    target.innerHTML = '<div class="empty-state">当前没有 dispatch</div>';
    return;
  }

  groups.forEach((group) => {
    const card = document.createElement("div");
    card.className = "dispatch-group";
    const previews = Array.isArray(group.messages)
      ? group.messages.map((message) => `#${message.message_id} ${message.from_snail || message.role}: ${message.preview || "(空消息)"}`).join("\n")
      : "";
    const status = describeDispatchStatus(group.status);
    const forcedCount = Number(group.forced_wrap_up_count || 0);
    const forcedLabel = forcedCount > 0 ? ` · 收口 ${forcedCount}` : "";
    card.innerHTML = `
      <div class="name">${escapeHtml(group.to_snail || "未知 Snail")}</div>
      <div class="meta">${escapeHtml(status.label)} · ${escapeHtml(status.description)}${escapeHtml(forcedLabel)}</div>
      <div class="meta">dispatches: ${group.dispatch_ids.length} · messages: ${group.message_ids.length}</div>
      <div class="meta" style="margin-top: 6px;">latest: ${escapeHtml(group.latest_dispatch_at || "")}</div>
      ${previews ? `<div class="dispatch-preview">${escapeHtml(previews)}</div>` : ""}
    `;
    target.appendChild(card);
  });
}

function summarizeGroups(groups) {
  return groups.reduce((summary, group) => {
    const count = Array.isArray(group.dispatch_ids) ? group.dispatch_ids.length : 0;
    if (group.status === "pending") summary.incoming += count;
    else if (group.status === "claimed") summary.running += count;
    else if (group.status === "consumed" || group.status === "seen" || group.status === "skipped") summary.completed += count;
    return summary;
  }, { incoming: 0, running: 0, completed: 0 });
}

function latestPreview(group) {
  const messages = Array.isArray(group.messages) ? group.messages : [];
  const latest = messages[messages.length - 1];
  return {
    from: latest?.from_snail || latest?.role || "system",
    text: truncatePreview(latest?.preview || ""),
  };
}

function truncatePreview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 72).trimEnd()}...` : normalized;
}

function formatTime(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function describeDispatchStatus(status) {
  switch (status) {
    case "pending":
      return { label: "待消费", short: "已进入目标 inbox", description: "消息已投递，等待目标 Snail 自主读取" };
    case "claimed":
      return { label: "消费中", short: "消费者正在生成", description: "目标 Snail 已读取 inbox，正在生成回复" };
    case "consumed":
      return { label: "已消费", short: "已生成回复", description: "投递已绑定到消费者生成的消息" };
    case "seen":
      return { label: "已读", short: "人工目标已确认", description: "人工目标已确认该投递" };
    case "skipped":
      return { label: "已跳过", short: "不再运行消费者", description: "系统处理后不再进入消费者运行" };
    default:
      return { label: String(status || "未知状态"), short: "未知状态", description: "未识别的消息总线状态" };
  }
}
