import { escapeHtml } from "./message-view.js";

/**
 * Knowledge Library view — standalone module for browsing published knowledge entries.
 *
 * Exports:
 *   createKnowledgeLibraryView({ api, showNotice })
 *     .load()   — fetch data and render into #knowledge-library-page
 *     .render() — re-render with cached data
 */

export function createKnowledgeLibraryView({ api }) {
  const state = { summary: {}, globalItems: [], workspaceItems: [], loaded: false };

  async function load() {
    const $page = document.getElementById("knowledge-library-page");
    if (!$page) return;

    try {
      const [summary, globalItems, workspaceItems] = await Promise.all([
        api("GET", "/knowledge/items/summary"),
        api("GET", "/knowledge/items?scope=global&limit=50"),
        api("GET", "/knowledge/items?scope=workspace&limit=50"),
      ]);

      state.summary = summary;
      state.globalItems = globalItems;
      state.workspaceItems = workspaceItems;
      state.loaded = true;
      render();
    } catch (err) {
      $page.innerHTML = `<div class="empty-state">Failed to load Knowledge Library: ${escapeHtml(err.message)}</div>`;
    }
  }

  function render() {
    const $page = document.getElementById("knowledge-library-page");
    if (!$page) return;

    const globalCount = state.summary?.global ?? 0;
    const workspaceCount = state.summary?.workspace ?? 0;

    $page.innerHTML = `
      <div class="knowledge-library">
        <div class="knowledge-library-header">
          <h1>Knowledge Library</h1>
          <p>Published knowledge entries approved through governance</p>
          <div class="knowledge-stats">
            <span class="badge">Global: ${globalCount}</span>
            <span class="badge">Workspace: ${workspaceCount}</span>
          </div>
        </div>
        <div class="knowledge-library-content">
          <div class="knowledge-section">
            <h2>Global Knowledge</h2>
            <div class="knowledge-list">
              ${state.globalItems.length ? state.globalItems.map(renderKnowledgeItem).join("") : '<div class="empty-state">No global knowledge</div>'}
            </div>
          </div>
          <div class="knowledge-section">
            <h2>Workspace Knowledge</h2>
            <div class="knowledge-list">
              ${state.workspaceItems.length ? state.workspaceItems.map(renderKnowledgeItem).join("") : '<div class="empty-state">No workspace knowledge</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return { load, render };
}

function renderKnowledgeItem(item) {
  return `
    <div class="knowledge-item" data-knowledge-id="${escapeHtml(item.id)}">
      <div class="knowledge-item-header">
        <h3>${escapeHtml(item.title)}</h3>
        <span class="badge">${escapeHtml(item.scope)}</span>
      </div>
      <div class="knowledge-item-snippet">${escapeHtml(item.snippet || item.content?.slice(0, 200) || "")}</div>
      <div class="knowledge-item-meta">
        <span>${escapeHtml(item.workspace_id || "global")}</span>
        <span>${formatTime(item.created_at)}</span>
      </div>
    </div>
  `;
}

function formatTime(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
}
