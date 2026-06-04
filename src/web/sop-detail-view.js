import { escapeHtml } from "./message-view.js";

/**
 * SOP detail rendering — detail view for SOP Center.
 */

export function renderSopDetail(detail) {
  if (detail._error) {
    return `<div class="sop-detail-error">加载详情失败：${escapeHtml(detail._error)}</div>`;
  }
  const stages = detail.stage_definitions || [];
  const transitions = detail.transitions || [];

  return `
    <div class="sop-detail">
      <div class="sop-detail-header">
        <h2>${escapeHtml(detail.name)}</h2>
        <span class="badge">${escapeHtml(detail.source)}</span>
        ${detail.source === "platform" ? `
          <div class="sop-detail-actions">
            <button class="ghost-button" id="sop-edit-btn">编辑</button>
            <button class="danger-button" id="sop-delete-btn">删除</button>
          </div>
        ` : ""}
      </div>
      ${detail.description ? `<p class="sop-detail-desc">${escapeHtml(detail.description)}</p>` : ""}
      ${detail.first_stage ? `<div class="context-line"><span>First Stage</span><span>${escapeHtml(detail.first_stage)}</span></div>` : ""}

      ${renderHandbookSection("Shared Handbook", detail.shared_handbook)}

      <h3>Stage Definitions</h3>
      <div class="sop-stages">
        ${stages.map(renderStageDetail).join("")}
      </div>

      ${transitions.length ? `
        <h3>Transitions</h3>
        <div class="sop-transitions">
          ${transitions.map((t) => `
            <div class="sop-transition">
              <span class="transition-from">${escapeHtml(t.from_stage_key)}</span>
              <span class="transition-arrow">\u2192</span>
              <span class="transition-to">${escapeHtml(t.to_stage_key)}</span>
              ${t.guard ? `<span class="badge">guard: ${escapeHtml(t.guard.type)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderStageDetail(stage) {
  const roles = stage.roles || [];
  return `
    <div class="sop-stage-card">
      <div class="sop-stage-header">
        <span class="sop-stage-seq">#${stage.sequence}</span>
        <h4>${escapeHtml(stage.title)}</h4>
        <span class="sop-stage-key">${escapeHtml(stage.key)}</span>
      </div>
      ${stage.input_description ? `<div class="sop-stage-io"><strong>Input:</strong> ${escapeHtml(stage.input_description)}</div>` : ""}
      ${stage.output_description ? `<div class="sop-stage-io"><strong>Output:</strong> ${escapeHtml(stage.output_description)}</div>` : ""}
      ${renderChecklist(stage.acceptance_checklist)}
      ${stage.acceptance_focus?.length ? `<div class="sop-stage-focus"><strong>Acceptance Focus:</strong><ul>${stage.acceptance_focus.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>` : ""}
      ${roles.length ? `
        <div class="sop-stage-roles">
          <strong>Roles:</strong>
          ${roles.map(renderRoleDetail).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderRoleDetail(role) {
  return `
    <div class="sop-role-card">
      <div class="sop-role-header">
        <span class="badge">${escapeHtml(role.name)}${role.is_primary ? " (primary)" : ""}</span>
        ${role.count > 1 ? `<span class="badge">x${role.count}</span>` : ""}
      </div>
      ${role.description ? `<div class="sop-role-desc">${escapeHtml(role.description)}</div>` : ""}
      ${renderHandbookSection("Handbook", role.handbook)}
    </div>
  `;
}

function renderChecklist(checklist) {
  if (!checklist?.length) return "";
  return `
    <div class="sop-checklist">
      <strong>Acceptance Checklist:</strong>
      <ul>
        ${checklist.map((item) => `
          <li>${escapeHtml(item.description)}${item.required ? ' <span class="badge">required</span>' : ""}</li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderHandbookSection(title, content) {
  if (!content) return "";
  const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
  const isLong = content.length > 200;
  return `
    <div class="sop-handbook-section">
      <div class="sop-handbook-header">
        <strong>${escapeHtml(title)}</strong>
        ${isLong ? `<button class="ghost-button sop-handbook-toggle" type="button">展开</button>` : ""}
      </div>
      <div class="sop-handbook-preview">${escapeHtml(preview)}</div>
      ${isLong ? `<div class="sop-handbook-full" hidden>${escapeHtml(content)}</div>` : ""}
    </div>
  `;
}

export function bindCollapsibles($page) {
  $page.querySelectorAll(".sop-handbook-toggle").forEach(($btn) => {
    $btn.addEventListener("click", () => {
      const section = $btn.closest(".sop-handbook-section");
      const preview = section.querySelector(".sop-handbook-preview");
      const full = section.querySelector(".sop-handbook-full");
      const isExpanded = !full.hidden;
      full.hidden = isExpanded;
      preview.hidden = !isExpanded;
      $btn.textContent = isExpanded ? "展开" : "收起";
    });
  });
}
