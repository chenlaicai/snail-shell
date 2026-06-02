import { escapeHtml } from "./message-view.js";

// builtin 标记从 API 数据中读取（每条 MCP 的 builtin 字段），不再硬编码

function transportType(server) {
  return server.url ? "HTTP" : server.command ? "stdio" : "unknown";
}

function transportDetail(server) {
  if (server.url) return server.url;
  if (server.command) return [server.command, ...(server.args || [])].join(" ");
  return "";
}

function renderMcpList(mcps, selectedName) {
  if (!mcps.length) return '<div class="empty-state">没有已配置的 MCP</div>';
  return mcps.map((mcp) => {
    const isActive = mcp.name === selectedName;
    const isBuiltin = !!mcp.builtin;
    const transport = transportType(mcp);
    return `<div class="mcp-list-item${isActive ? " active" : ""}" data-mcp-name="${escapeHtml(mcp.name)}" role="option" aria-selected="${isActive ? "true" : "false"}">
      <span class="mcp-list-item-name">${escapeHtml(mcp.name)}${isBuiltin ? ' <span class="mcp-builtin-tag">内置</span>' : ""}</span>
      <span class="mcp-list-item-transport mcp-transport-${transport.toLowerCase()}">${transport}</span>
    </div>`;
  }).join("");
}

function renderMcpDetail(mcp) {
  if (!mcp) return '<div class="mcp-detail-empty">选择左侧 MCP 查看详细信息</div>';
  const isBuiltin = !!mcp.builtin;
  const transport = transportType(mcp);
  const detail = transportDetail(mcp);

  const transportFields = transport === "HTTP"
    ? `<div class="mcp-detail-field"><span class="mcp-detail-label">URL</span><span class="mcp-detail-value">${escapeHtml(detail)}</span></div>`
    : transport === "stdio"
      ? `<div class="mcp-detail-field"><span class="mcp-detail-label">Command</span><span class="mcp-detail-value">${escapeHtml(detail)}</span></div>`
      : "";

  const envFields = mcp.env && Object.keys(mcp.env).length
    ? `<div class="mcp-detail-field"><span class="mcp-detail-label">Env</span><pre class="mcp-detail-pre">${escapeHtml(JSON.stringify(mcp.env, null, 2))}</pre></div>`
    : "";

  return `<div class="mcp-detail-card">
    <div class="mcp-detail-hero">
      <div>
        <div class="mcp-eyebrow">MCP Server</div>
        <div class="mcp-detail-title">${escapeHtml(mcp.name)}</div>
      </div>
    </div>
    <div class="mcp-chip-row">
      <span class="mcp-chip mcp-transport-${transport.toLowerCase()}">${transport}</span>
      ${isBuiltin ? '<span class="mcp-chip mcp-chip-builtin">内置</span>' : ""}
    </div>
    <section class="mcp-info-panel">
      <div class="mcp-section-heading">连接信息</div>
      ${transportFields || '<div class="mcp-detail-field"><span class="mcp-detail-label">Transport</span><span class="mcp-detail-value">未知</span></div>'}
      ${envFields}
    </section>
  </div>`;
}

/**
 * Create an MCP Center instance.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Container element
 * @returns {{ setMcps: (mcps: any[]) => void }}
 */
export function createMcpCenter({ root }) {
  const state = {
    mcps: [],
    selectedName: null,
  };

  function getSelectedMcp() {
    return state.mcps.find((m) => m.name === state.selectedName) || null;
  }

  function render() {
    if (!state.selectedName || !state.mcps.some((m) => m.name === state.selectedName)) {
      state.selectedName = state.mcps.length ? state.mcps[0].name : null;
    }

    const statsHtml = `<div class="mcp-center-stats">
      <div class="mcp-stat"><strong>${state.mcps.length}</strong><span>MCPs</span></div>
      <div class="mcp-stat"><strong>${state.mcps.filter((m) => transportType(m) === "HTTP").length}</strong><span>HTTP</span></div>
      <div class="mcp-stat"><strong>${state.mcps.filter((m) => transportType(m) === "stdio").length}</strong><span>stdio</span></div>
    </div>`;

    root.innerHTML = `<div class="mcp-center-layout">
      <div class="mcp-center-list-panel">
        <div class="mcp-center-header"><div class="mcp-eyebrow">MCP Center</div><div class="mcp-center-title">已配置 MCP</div></div>
        ${statsHtml}
        <div class="mcp-list">${renderMcpList(state.mcps, state.selectedName)}</div>
      </div>
      <div class="mcp-center-detail-panel">
        ${renderMcpDetail(getSelectedMcp())}
      </div>
    </div>`;

    bindEvents();
  }

  function bindEvents() {
    root.querySelectorAll(".mcp-list-item").forEach((el) => {
      el.addEventListener("click", () => {
        state.selectedName = el.getAttribute("data-mcp-name");
        render();
      });
    });
  }

  return {
    setMcps(mcps) {
      state.mcps = Array.isArray(mcps) ? mcps : [];
      render();
    },
  };
}
