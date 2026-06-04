import { escapeHtml } from "./message-view.js";
import { renderSopForm } from "./sop-form-view.js";
import { renderSopDetail, bindCollapsibles } from "./sop-detail-view.js";

/**
 * SOP Center view — list, detail, create, edit, delete SOPs.
 */

// ── State ────────────────────────────────────────────────────────────

const EMPTY_STATE = () => ({
  sops: [], selectedId: null, detail: null, loaded: false,
  mode: /** @type {"list"|"detail"|"create"|"edit"} */ ("list"),
});

// ── Entry point ──────────────────────────────────────────────────────

export function createSopCenter({ api, showNotice }) {
  const state = EMPTY_STATE();

  async function load() {
    const $page = document.getElementById("sop-center-page");
    if (!$page) return;
    try {
      state.sops = await api("GET", "/api/sops");
      state.loaded = true;
      state.selectedId = null;
      state.detail = null;
      state.mode = "list";
      render();
    } catch (err) {
      $page.innerHTML = `<div class="empty-state">加载 SOP 列表失败：${escapeHtml(err.message)}</div>`;
    }
  }

  function render() {
    const $page = document.getElementById("sop-center-page");
    if (!$page) return;

    switch (state.mode) {
      case "create": renderForm($page, null); break;
      case "edit": renderForm($page, state.detail); break;
      case "detail": renderListWithDetail($page); break;
      default: renderListWithDetail($page);
    }
  }

  async function selectSop(sopId) {
    state.selectedId = sopId;
    state.detail = null;
    state.mode = "list";
    render();
    try {
      state.detail = await api("GET", `/api/sops/${encodeURIComponent(sopId)}`);
      state.mode = "detail";
      render();
    } catch (err) {
      state.detail = { _error: err.message };
      state.mode = "detail";
      render();
    }
  }

  // ── List + Detail ──────────────────────────────────────────────────

  function renderListWithDetail($page) {
    const platformSops = state.sops.filter((s) => s.source === "platform");
    const workspaceSops = state.sops.filter((s) => s.source === "workspace");

    $page.innerHTML = `
      <div class="sop-center">
        <div class="sop-center-header">
          <h1>SOP Center</h1>
          <p>Standard Operating Procedures — 定义 Issue 的阶段流转、角色分工和验收标准</p>
          <div class="sop-stats">
            <span class="badge">Platform: ${platformSops.length}</span>
            <span class="badge">Workspace: ${workspaceSops.length}</span>
          </div>
        </div>
        <div class="sop-center-toolbar">
          <button class="primary-button" id="sop-create-btn">新建 SOP</button>
        </div>
        <div class="sop-center-content">
          <div class="sop-list-section">
            <h2>Platform SOPs</h2>
            <div class="sop-list">
              ${platformSops.length ? platformSops.map((s) => renderSopCard(s, state.selectedId)).join("") : '<div class="empty-state">No platform SOPs</div>'}
            </div>
          </div>
          <div class="sop-list-section">
            <h2>Workspace SOPs</h2>
            <div class="sop-list">
              ${workspaceSops.length ? workspaceSops.map((s) => renderSopCard(s, state.selectedId)).join("") : '<div class="empty-state">No workspace SOPs</div>'}
            </div>
          </div>
          ${state.mode === "detail" && state.detail ? renderSopDetail(state.detail) : ""}
        </div>
      </div>
    `;

    $page.querySelectorAll(".sop-card").forEach(($card) => {
      $card.addEventListener("click", () => selectSop($card.dataset.sopId));
    });
    const $createBtn = $page.querySelector("#sop-create-btn");
    if ($createBtn) $createBtn.addEventListener("click", () => { state.mode = "create"; render(); });

    const $editBtn = $page.querySelector("#sop-edit-btn");
    if ($editBtn) $editBtn.addEventListener("click", () => { state.mode = "edit"; render(); });

    const $deleteBtn = $page.querySelector("#sop-delete-btn");
    if ($deleteBtn) $deleteBtn.addEventListener("click", () => confirmDelete($page));

    bindCollapsibles($page);
  }

  function confirmDelete($page) {
    if (!state.detail) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-dialog">
        <h3>确认删除</h3>
        <p>确定要删除 SOP <strong>${escapeHtml(state.detail.name)}</strong> 吗？此操作不可撤销。</p>
        <p class="meta">已有 issue 不受影响（运行时数据来自快照）。</p>
        <div class="button-row">
          <button class="danger-button" id="modal-confirm-delete">删除</button>
          <button class="ghost-button" id="modal-cancel-delete">取消</button>
        </div>
      </div>
    `;
    $page.appendChild(overlay);
    overlay.querySelector("#modal-cancel-delete").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#modal-confirm-delete").addEventListener("click", async () => {
      const $btn = overlay.querySelector("#modal-confirm-delete");
      $btn.disabled = true; $btn.textContent = "删除中...";
      try {
        const result = await api("DELETE", `/api/sops/${encodeURIComponent(state.detail.id)}`);
        overlay.remove();
        state.selectedId = null; state.detail = null;
        await load();
        if (result?.affected_workspaces?.length) {
          showNotice(`已清理 ${result.affected_workspaces.length} 个 workspace 的 SOP 绑定`);
        }
      } catch (err) {
        $btn.disabled = false; $btn.textContent = "删除";
        alert(`删除失败：${err.message}`);
      }
    });
  }

  // ── Create / Edit form ─────────────────────────────────────────────

  function renderForm($page, existing) {
    const isEdit = Boolean(existing);
    renderSopForm($page, existing,
      async (data) => {
        if (isEdit) {
          await api("PATCH", `/api/sops/${encodeURIComponent(existing.id)}`, data);
        } else {
          await api("POST", "/api/sops", data);
        }
        state.mode = "list";
        await load();
      },
      () => { state.mode = state.detail ? "detail" : "list"; render(); },
    );
  }

  return { load, render };
}

// ── Card rendering ───────────────────────────────────────────────────

function renderSopCard(sop, selectedId) {
  const selected = sop.id === selectedId ? " is-selected" : "";
  return `
    <div class="sop-card${selected}" data-sop-id="${escapeHtml(sop.id)}">
      <div class="sop-card-header">
        <h3>${escapeHtml(sop.name)}</h3>
        <span class="badge">${escapeHtml(sop.source)}</span>
      </div>
      <div class="sop-card-key">${escapeHtml(sop.key)}</div>
      ${sop.description ? `<div class="sop-card-desc">${escapeHtml(sop.description)}</div>` : ""}
    </div>
  `;
}
