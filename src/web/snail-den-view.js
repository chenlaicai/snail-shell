/**
 * Snail Den 视图：展示 snail template 池中的所有可用配置。
 * 每个 template 是一个 agent runtime + model 的组合，后续对话从池中选取 template 创建独立实例。
 */
export function renderSnailDen(container, templates) {
  if (!container) return;
  if (!Array.isArray(templates) || templates.length === 0) {
    container.innerHTML = '<div class="snail-den-empty">暂无 snail template</div>';
    return;
  }

  container.innerHTML = `
    <div class="snail-den-header">
      <div class="snail-den-title">Snail Den</div>
      <div class="snail-den-subtitle">snail template 池 — 每个 template 定义一个 agent runtime + model 组合</div>
    </div>
    <div class="snail-den-grid">
      ${templates.map((template) => renderSnailCard(template)).join("")}
    </div>
  `;
}

function renderSnailCard(template) {
  const runtimeLabel = formatRuntime(template.runtime);
  const contextLabel = template.contextWindow ? `${Math.round(template.contextWindow / 1000)}k` : "—";
  return `
    <div class="snail-den-card" data-snail-id="${escapeAttr(template.id)}">
      <div class="snail-den-card-header">
        <div class="snail-den-card-icon">S</div>
        <div class="snail-den-card-title">${escapeHtml(template.name)}</div>
      </div>
      <div class="snail-den-card-body">
        <div class="snail-den-card-field">
          <span class="snail-den-card-label">ID</span>
          <span class="snail-den-card-value">${escapeHtml(template.id)}</span>
        </div>
        <div class="snail-den-card-field">
          <span class="snail-den-card-label">Runtime</span>
          <span class="snail-den-card-value">${escapeHtml(runtimeLabel)}</span>
        </div>
        <div class="snail-den-card-field">
          <span class="snail-den-card-label">Model</span>
          <span class="snail-den-card-value">${escapeHtml(template.model)}</span>
        </div>
        <div class="snail-den-card-field">
          <span class="snail-den-card-label">Context Window</span>
          <span class="snail-den-card-value">${escapeHtml(contextLabel)}</span>
        </div>
      </div>
    </div>
  `;
}

function formatRuntime(runtime) {
  const labels = {
    "claude-code-cli": "Claude Code",
    "opencode-cli": "OpenCode",
    "codex-cli": "Codex",
    "gemini-cli": "Gemini",
  };
  return labels[runtime] || runtime;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
