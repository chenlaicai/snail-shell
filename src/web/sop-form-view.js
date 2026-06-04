import { escapeHtml } from "./message-view.js";

/**
 * SOP form rendering — create/edit form for SOP Center.
 *
 * Exports:
 *   renderSopForm($page, existing, onSubmit, onCancel)
 */

export function renderSopForm($page, existing, onSubmit, onCancel) {
  const isEdit = Boolean(existing);
  const title = isEdit ? "编辑 SOP" : "新建 SOP";
  const formData = isEdit ? sopToForm(existing) : defaultFormData();

  $page.innerHTML = `
    <div class="sop-center">
      <div class="sop-center-header">
        <h1>${title}</h1>
        ${isEdit ? `<p>${escapeHtml(existing.name)}</p>` : ""}
      </div>
      <form class="sop-form" id="sop-form">
        <div class="sop-form-section">
          <h3>基本信息</h3>
          <div class="form-row">
            <div class="form-group">
              <label for="sop-key">Key (唯一标识)</label>
              <input type="text" id="sop-key" value="${escapeHtml(formData.key)}" ${isEdit ? "readonly" : ""} required />
            </div>
            <div class="form-group">
              <label for="sop-name">Name</label>
              <input type="text" id="sop-name" value="${escapeHtml(formData.name)}" required />
            </div>
          </div>
          <div class="form-group">
            <label for="sop-description">Description</label>
            <textarea id="sop-description" rows="2">${escapeHtml(formData.description)}</textarea>
          </div>
          <div class="form-group">
            <label for="sop-first-stage">First Stage Key</label>
            <input type="text" id="sop-first-stage" value="${escapeHtml(formData.first_stage)}" placeholder="留空则取 sequence 最小的 stage" />
          </div>
        </div>

        <div class="sop-form-section">
          <h3>Shared Handbook</h3>
          <div class="form-group">
            <textarea id="sop-shared-handbook" rows="6" placeholder="所有角色共用的操作手册（可选）">${escapeHtml(formData.shared_handbook)}</textarea>
          </div>
        </div>

        <div class="sop-form-section">
          <h3>Stage Definitions</h3>
          <div id="sop-stages-container"></div>
          <button type="button" class="ghost-button" id="add-stage-btn">+ 添加 Stage</button>
        </div>

        <div class="sop-form-section">
          <h3>Transitions</h3>
          <div id="sop-transitions-container"></div>
          <button type="button" class="ghost-button" id="add-transition-btn">+ 添加 Transition</button>
        </div>

        <div class="form-actions button-row">
          <button type="submit" class="primary-button">${isEdit ? "保存" : "创建"}</button>
          <button type="button" class="ghost-button" id="sop-form-cancel">取消</button>
        </div>
        <div id="sop-form-error" class="form-error" style="display:none"></div>
      </form>
    </div>
  `;

  const $stagesContainer = $page.querySelector("#sop-stages-container");
  const $transitionsContainer = $page.querySelector("#sop-transitions-container");

  formData.stages.forEach((stage, i) => appendStageBlock($stagesContainer, stage, i));
  formData.transitions.forEach((t) => appendTransitionBlock($transitionsContainer, t));

  $page.querySelector("#add-stage-btn").addEventListener("click", () => {
    const idx = $stagesContainer.querySelectorAll(".sop-stage-form").length;
    appendStageBlock($stagesContainer, defaultStage(), idx);
  });

  $page.querySelector("#add-transition-btn").addEventListener("click", () => {
    appendTransitionBlock($transitionsContainer, defaultTransition());
  });

  $page.querySelector("#sop-form-cancel").addEventListener("click", onCancel);

  $page.querySelector("#sop-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const $error = $page.querySelector("#sop-form-error");
    $error.style.display = "none";
    try {
      const data = collectFormData($page);
      if (!data.key || !data.name) throw new Error("Key 和 Name 为必填项");
      if (data.stage_definitions.length === 0) throw new Error("至少需要一个 Stage Definition");
      await onSubmit(data);
    } catch (err) {
      $error.textContent = err.message;
      $error.style.display = "block";
    }
  });
}

// ── Stage form block ─────────────────────────────────────────────────

function appendStageBlock($container, stage, idx) {
  const block = document.createElement("div");
  block.className = "sop-stage-form";
  block.dataset.index = String(idx);
  block.innerHTML = `
    <div class="sop-stage-form-header">
      <h4>Stage #${idx + 1}</h4>
      <button type="button" class="danger-button sop-stage-remove">移除</button>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Key</label><input type="text" class="stage-key" value="${escapeHtml(stage.key)}" required /></div>
      <div class="form-group"><label>Title</label><input type="text" class="stage-title" value="${escapeHtml(stage.title)}" required /></div>
      <div class="form-group"><label>Sequence</label><input type="number" class="stage-sequence" value="${stage.sequence}" min="1" required /></div>
    </div>
    <div class="form-group"><label>Input Description</label><textarea class="stage-input" rows="2">${escapeHtml(stage.input_description)}</textarea></div>
    <div class="form-group"><label>Output Description</label><textarea class="stage-output" rows="2">${escapeHtml(stage.output_description)}</textarea></div>
    <div class="form-group">
      <label>Acceptance Focus (每行一条)</label>
      <textarea class="stage-focus" rows="3" placeholder="需求是否已对齐&#10;设计是否已锁定">${escapeHtml(stage.acceptance_focus.join("\n"))}</textarea>
    </div>
    <div class="form-group">
      <label>Acceptance Checklist</label>
      <div class="checklist-container">
        ${(stage.acceptance_checklist || []).map((item, ci) => renderChecklistItemForm(ci, item)).join("")}
      </div>
      <button type="button" class="ghost-button add-checklist-item">+ 添加 Checklist 项</button>
    </div>
    <div class="sop-roles-section">
      <h5>Roles</h5>
      <div class="roles-container">
        ${stage.roles.map((role, ri) => renderRoleForm(ri, role)).join("")}
      </div>
      <button type="button" class="ghost-button add-role-btn">+ 添加 Role</button>
    </div>
  `;
  $container.appendChild(block);

  block.querySelector(".sop-stage-remove").addEventListener("click", () => { block.remove(); renumberStages($container); });
  block.querySelector(".add-checklist-item").addEventListener("click", () => {
    const $cl = block.querySelector(".checklist-container");
    const ci = $cl.querySelectorAll(".checklist-item-form").length;
    $cl.insertAdjacentHTML("beforeend", renderChecklistItemForm(ci, { id: "", description: "", required: false }));
  });
  block.querySelector(".add-role-btn").addEventListener("click", () => {
    const $roles = block.querySelector(".roles-container");
    const ri = $roles.querySelectorAll(".role-form").length;
    $roles.insertAdjacentHTML("beforeend", renderRoleForm(ri, { key: "", name: "", description: "", is_primary: false, count: 1, handbook: "" }));
  });

  block.addEventListener("click", (e) => {
    if (e.target.classList.contains("checklist-item-remove")) e.target.closest(".checklist-item-form").remove();
    if (e.target.classList.contains("role-remove")) e.target.closest(".role-form").remove();
    if (e.target.classList.contains("handbook-toggle")) {
      const ta = e.target.closest(".form-group").querySelector("textarea");
      if (ta.rows <= 3) { ta.rows = 10; e.target.textContent = "收起"; }
      else { ta.rows = 3; e.target.textContent = "展开"; }
    }
  });
}

function renumberStages($container) {
  $container.querySelectorAll(".sop-stage-form").forEach((block, i) => {
    block.dataset.index = String(i);
    block.querySelector("h4").textContent = `Stage #${i + 1}`;
  });
}

function renderChecklistItemForm(idx, item) {
  return `
    <div class="checklist-item-form">
      <input type="text" class="checklist-id" placeholder="ID (e.g. dev-01)" value="${escapeHtml(item.id || "")}" />
      <input type="text" class="checklist-desc" placeholder="描述" value="${escapeHtml(item.description || "")}" style="flex:1" />
      <label class="checkbox-label"><input type="checkbox" class="checklist-required" ${item.required ? "checked" : ""} /> required</label>
      <button type="button" class="danger-button checklist-item-remove">x</button>
    </div>
  `;
}

function renderRoleForm(idx, role) {
  return `
    <div class="role-form">
      <div class="form-row">
        <div class="form-group"><label>Key</label><input type="text" class="role-key" value="${escapeHtml(role.key)}" required /></div>
        <div class="form-group"><label>Name</label><input type="text" class="role-name" value="${escapeHtml(role.name)}" required /></div>
        <div class="form-group"><label>Count</label><input type="number" class="role-count" value="${role.count || 1}" min="1" /></div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" class="role-primary" ${role.is_primary ? "checked" : ""} /> Primary</label></div>
      </div>
      <div class="form-group"><label>Description</label><textarea class="role-description" rows="2">${escapeHtml(role.description || "")}</textarea></div>
      <div class="form-group">
        <label>Handbook <button type="button" class="ghost-button handbook-toggle" style="font-size:11px">展开</button></label>
        <textarea class="role-handbook" rows="3" placeholder="角色操作手册（markdown）">${escapeHtml(role.handbook || "")}</textarea>
      </div>
      <button type="button" class="danger-button role-remove" style="font-size:11px">移除 Role</button>
    </div>
  `;
}

// ── Transition form block ────────────────────────────────────────────

function appendTransitionBlock($container, transition) {
  const block = document.createElement("div");
  block.className = "sop-transition-form";
  block.innerHTML = `
    <input type="text" class="transition-from" placeholder="from stage key" value="${escapeHtml(transition.from)}" required />
    <span class="transition-arrow">\u2192</span>
    <input type="text" class="transition-to" placeholder="to stage key" value="${escapeHtml(transition.to)}" required />
    <button type="button" class="danger-button transition-remove">x</button>
  `;
  $container.appendChild(block);
  block.querySelector(".transition-remove").addEventListener("click", () => block.remove());
}

// ── Data conversion ──────────────────────────────────────────────────

function sopToForm(detail) {
  return {
    key: detail.key || "",
    name: detail.name || "",
    description: detail.description || "",
    first_stage: detail.first_stage || "",
    shared_handbook: detail.shared_handbook || "",
    stages: (detail.stage_definitions || []).map((sd) => ({
      key: sd.key || "",
      title: sd.title || "",
      sequence: sd.sequence || 1,
      input_description: sd.input_description || "",
      output_description: sd.output_description || "",
      acceptance_focus: sd.acceptance_focus || [],
      acceptance_checklist: sd.acceptance_checklist || [],
      roles: (sd.roles || []).map((r) => ({
        key: r.key || "",
        name: r.name || "",
        description: r.description || "",
        is_primary: Boolean(r.is_primary),
        count: r.count || 1,
        handbook: r.handbook || "",
      })),
    })),
    transitions: (detail.transitions || []).map((t) => ({
      from: t.from_stage_key || "",
      to: t.to_stage_key || "",
    })),
  };
}

function defaultFormData() {
  return {
    key: "", name: "", description: "", first_stage: "", shared_handbook: "",
    stages: [defaultStage()],
    transitions: [],
  };
}

function defaultStage() {
  return {
    key: "", title: "", sequence: 1,
    input_description: "", output_description: "",
    acceptance_focus: [], acceptance_checklist: [],
    roles: [defaultRole()],
  };
}

function defaultRole() {
  return { key: "", name: "", description: "", is_primary: false, count: 1, handbook: "" };
}

function defaultTransition() {
  return { from: "", to: "" };
}

export function collectFormData($page) {
  const key = val($page, "#sop-key");
  const name = val($page, "#sop-name");
  const description = val($page, "#sop-description");
  const first_stage = val($page, "#sop-first-stage");
  const shared_handbook = val($page, "#sop-shared-handbook");

  const stage_definitions = [];
  $page.querySelectorAll(".sop-stage-form").forEach((block) => {
    const focusRaw = block.querySelector(".stage-focus").value.trim();
    const acceptance_focus = focusRaw ? focusRaw.split("\n").map((s) => s.trim()).filter(Boolean) : [];

    const acceptance_checklist = [];
    block.querySelectorAll(".checklist-item-form").forEach((ci) => {
      const id = ci.querySelector(".checklist-id").value.trim();
      const desc = ci.querySelector(".checklist-desc").value.trim();
      const required = ci.querySelector(".checklist-required").checked;
      if (id && desc) acceptance_checklist.push({ id, description: desc, required });
    });

    const roles = [];
    block.querySelectorAll(".role-form").forEach((rf) => {
      const roleKey = rf.querySelector(".role-key").value.trim();
      const roleName = rf.querySelector(".role-name").value.trim();
      if (!roleKey || !roleName) return;
      roles.push({
        key: roleKey,
        name: roleName,
        description: rf.querySelector(".role-description").value.trim() || undefined,
        is_primary: rf.querySelector(".role-primary").checked || undefined,
        count: parseInt(rf.querySelector(".role-count").value, 10) || 1,
        handbook: rf.querySelector(".role-handbook").value.trim() || undefined,
      });
    });

    const stageKey = block.querySelector(".stage-key").value.trim();
    const stageTitle = block.querySelector(".stage-title").value.trim();
    if (!stageKey || !stageTitle) return;

    stage_definitions.push({
      key: stageKey,
      title: stageTitle,
      sequence: parseInt(block.querySelector(".stage-sequence").value, 10) || 1,
      input_description: block.querySelector(".stage-input").value.trim() || undefined,
      output_description: block.querySelector(".stage-output").value.trim() || undefined,
      acceptance_focus: acceptance_focus.length ? acceptance_focus : undefined,
      acceptance_checklist: acceptance_checklist.length ? acceptance_checklist : undefined,
      roles,
    });
  });

  const transitions = [];
  $page.querySelectorAll(".sop-transition-form").forEach((block) => {
    const from = block.querySelector(".transition-from").value.trim();
    const to = block.querySelector(".transition-to").value.trim();
    if (from && to) transitions.push({ from, to });
  });

  return {
    key, name,
    description: description || undefined,
    first_stage: first_stage || undefined,
    shared_handbook: shared_handbook || undefined,
    stage_definitions,
    transitions: transitions.length ? transitions : undefined,
  };
}

function val($page, selector) {
  return ($page.querySelector(selector)?.value || "").trim();
}
