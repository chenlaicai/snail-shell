export const DEFAULT_WORKSPACE_STAGE_DEFINITIONS = [
  {
    key: "development",
    title: "研发迭代",
    sequence: 1,
    input_description: "需求、问题线索、上一阶段输出或用户补充。",
    output_description: "完成需求收敛、设计、实现、自检，并提交可检视 PR。",
    acceptance_focus: ["需求边界已收敛", "实现已完成必要验证", "PR 可进入检视"],
    roles: [
      { name: "研发者", snail_template_id: "", is_primary: true, description: "负责需求讨论、设计取舍、实现、自检、提交 PR，并处理检视意见。", working_rules: ["需求不清时先和用户讨论并收敛", "完成开发后必须自检并提交 PR"] },
    ],
  },
  {
    key: "review",
    title: "PR 检视",
    sequence: 2,
    input_description: "上一阶段产出的 PR 交付记录。",
    output_description: "完成 PR 检视、意见处理和复检，直到没有待处理问题。",
    acceptance_focus: ["检视意见已处理或回应", "验证结果可追溯", "可等待用户合入"],
    roles: [
      { name: "研发者", snail_template_id: "", is_primary: true, description: "负责处理检视意见并更新 PR。", working_rules: ["逐条处理或理性回应检视意见"] },
      { name: "检视者", snail_template_id: "", is_primary: false, description: "负责对 PR 做对抗性代码检视，并留下可追溯评论。", working_rules: ["以 PR 实际 diff 和上下文为依据", "修复后必须重新检视"] },
    ],
  },
];

const REQUIRED_WORKFLOW_STAGE_KEYS = ["development", "review"];

function splitLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function syncDraftFromDom(root, draft) {
  if (!draft) return null;
  draft.name = root.querySelector('[data-workspace-field="name"]')?.value.trim() || "";
  draft.summary = root.querySelector('[data-workspace-field="summary"]')?.value.trim() || "";
  draft.workspace_root = root.querySelector('[data-workspace-field="workspace_root"]')?.value.trim() || "";
  draft.stage_definitions.forEach((stage, stageIndex) => {
    root.querySelectorAll(`[data-stage-index="${stageIndex}"][data-stage-field]`).forEach((node) => {
      const field = node.dataset.stageField;
      stage[field] = field === "acceptance_focus" ? splitLines(node.value) : node.value.trim();
    });
    stage.roles.forEach((role, roleIndex) => {
      root.querySelectorAll(`[data-stage-index="${stageIndex}"][data-role-index="${roleIndex}"][data-role-field]`).forEach((node) => {
        const field = node.dataset.roleField;
        if (field === "is_primary") role.is_primary = node.checked;
        else role[field] = field === "working_rules" ? splitLines(node.value) : node.value.trim();
      });
    });
  });
  return draft;
}

function validateDraft(synced) {
  if (!synced?.name) return "工作区名称不能为空";
  if (!synced.stage_definitions.length) return "至少需要一个 stage";
  const stageKeys = new Set();
  for (const stage of synced.stage_definitions) {
    if (!stage.key || !stage.title) return "每个 stage 都必须配置 key 和显示名称";
    if (stageKeys.has(stage.key)) return `Stage key 不能重复：${stage.key}`;
    stageKeys.add(stage.key);
    if (!stage.roles.length) return `Stage「${stage.title}」至少需要一个 role`;
    if (!stage.roles.some((role) => role.is_primary)) return `Stage「${stage.title}」必须选择主角色`;
    const roleNames = new Set();
    for (const role of stage.roles) {
      if (!role.name || !role.snail_template_id) return `Stage「${stage.title}」里的 role 必须配置名称和 Snail Template`;
      if (roleNames.has(role.name)) return `Stage「${stage.title}」里的 role 名称不能重复：${role.name}`;
      roleNames.add(role.name);
    }
  }
  for (const requiredKey of REQUIRED_WORKFLOW_STAGE_KEYS) {
    if (!stageKeys.has(requiredKey)) return `当前工作流要求保留 ${requiredKey} stage`;
  }
  return null;
}

export function createWorkspaceConfigController(input) {
  const { root, getTemplates, escapeHtml, onCancel, onSubmit } = input;
  let draft = null;

  function start() {
    const fallbackTemplateId = getTemplates()[0]?.id || "";
    draft = {
      name: "",
      summary: "",
      workspace_root: "",
      stage_definitions: DEFAULT_WORKSPACE_STAGE_DEFINITIONS.map((stage) => ({
        ...stage,
        acceptance_focus: [...stage.acceptance_focus],
        roles: stage.roles.map((role) => ({ ...role, working_rules: [...role.working_rules], snail_template_id: fallbackTemplateId })),
      })),
    };
    render();
    return draft;
  }

  function clear() {
    draft = null;
    root.innerHTML = "";
  }

  function render() {
    if (!draft) return;
    const templateOptions = getTemplates().map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} · ${escapeHtml(template.runtime)} · ${escapeHtml(template.model)}</option>`).join("");
    root.innerHTML = `
      <section class="workspace-config-hero">
        <div>
          <div class="panel-title">Workspace Configuration</div>
          <h1>新建 Workspace</h1>
          <p>工作区创建时会一次性写入 stage、stage 上的角色职责，以及每个 role 绑定的 Snail Den template。后续对话派发时，系统按 role 找到 template，再解析到具体 runtime 和 model。</p>
        </div>
        <div class="button-row">
          <button class="ghost-button" data-workspace-config-action="cancel">取消</button>
          <button class="primary-button" data-workspace-config-action="submit">创建工作区</button>
        </div>
      </section>
      <section class="workspace-config-card">
        <label>工作区名称<input class="workspace-config-input" data-workspace-field="name" value="${escapeHtml(draft.name)}" placeholder="例如：客户支持工作台"></label>
        <label>工作区摘要<textarea class="workspace-config-input" data-workspace-field="summary" rows="3" placeholder="说明工作区长期目标、上下文或交付边界">${escapeHtml(draft.summary)}</textarea></label>
        <label>工作目录<input class="workspace-config-input" data-workspace-field="workspace_root" value="${escapeHtml(draft.workspace_root)}" placeholder="留空则自动创建 ~/SnailShell/workspaces/<id>/"></label>
      </section>
      <section class="workspace-config-stage-list">
        ${draft.stage_definitions.map((stage, stageIndex) => renderStageEditor(stage, stageIndex, templateOptions)).join("")}
      </section>
      <div class="workspace-config-footer"><button class="secondary-button" data-workspace-config-action="add-stage">新增 Stage</button></div>
    `;
    draft.stage_definitions.forEach((stage, stageIndex) => stage.roles.forEach((role, roleIndex) => {
      const select = root.querySelector(`[data-stage-index="${stageIndex}"][data-role-index="${roleIndex}"][data-role-field="snail_template_id"]`);
      if (select) select.value = role.snail_template_id;
    }));
  }

  function renderStageEditor(stage, stageIndex, templateOptions) {
    return `
      <article class="workspace-config-stage" data-stage-index="${stageIndex}">
        <div class="workspace-config-stage-header">
          <div><div class="panel-title">Stage ${stageIndex + 1}</div><strong>${escapeHtml(stage.title || stage.key || "未命名 Stage")}</strong></div>
          <button class="ghost-button" data-workspace-config-action="remove-stage" data-stage-index="${stageIndex}">移除</button>
        </div>
        <div class="workspace-config-grid">
          <label>Stage Key<input class="workspace-config-input" data-stage-index="${stageIndex}" data-stage-field="key" value="${escapeHtml(stage.key)}"></label>
          <label>显示名称<input class="workspace-config-input" data-stage-index="${stageIndex}" data-stage-field="title" value="${escapeHtml(stage.title)}"></label>
          <label>输入要求<textarea class="workspace-config-input" data-stage-index="${stageIndex}" data-stage-field="input_description" rows="3">${escapeHtml(stage.input_description || "")}</textarea></label>
          <label>输出要求<textarea class="workspace-config-input" data-stage-index="${stageIndex}" data-stage-field="output_description" rows="3">${escapeHtml(stage.output_description || "")}</textarea></label>
        </div>
        <label>验收要点（每行一条）<textarea class="workspace-config-input" data-stage-index="${stageIndex}" data-stage-field="acceptance_focus" rows="3">${escapeHtml((stage.acceptance_focus || []).join("\n"))}</textarea></label>
        <div class="workspace-config-role-list">
          ${(stage.roles || []).map((role, roleIndex) => renderRoleEditor(role, stageIndex, roleIndex, templateOptions)).join("")}
        </div>
        <button class="secondary-button" data-workspace-config-action="add-role" data-stage-index="${stageIndex}">新增 Role</button>
      </article>
    `;
  }

  function renderRoleEditor(role, stageIndex, roleIndex, templateOptions) {
    return `
      <div class="workspace-config-role" data-stage-index="${stageIndex}" data-role-index="${roleIndex}">
        <div class="workspace-config-role-header">
          <strong>${escapeHtml(role.name || `Role ${roleIndex + 1}`)}</strong>
          <label class="workspace-config-primary"><input type="radio" name="primary-role-${stageIndex}" data-stage-index="${stageIndex}" data-role-index="${roleIndex}" data-role-field="is_primary" ${role.is_primary ? "checked" : ""}> 主角色</label>
          <button class="ghost-button" data-workspace-config-action="remove-role" data-stage-index="${stageIndex}" data-role-index="${roleIndex}">移除</button>
        </div>
        <div class="workspace-config-grid">
          <label>Role 名称<input class="workspace-config-input" data-stage-index="${stageIndex}" data-role-index="${roleIndex}" data-role-field="name" value="${escapeHtml(role.name)}"></label>
          <label>Snail Template<select class="workspace-config-input" data-stage-index="${stageIndex}" data-role-index="${roleIndex}" data-role-field="snail_template_id">${templateOptions}</select></label>
          <label>职责描述<textarea class="workspace-config-input" data-stage-index="${stageIndex}" data-role-index="${roleIndex}" data-role-field="description" rows="3">${escapeHtml(role.description || "")}</textarea></label>
          <label>工作规则（每行一条）<textarea class="workspace-config-input" data-stage-index="${stageIndex}" data-role-index="${roleIndex}" data-role-field="working_rules" rows="3">${escapeHtml((role.working_rules || []).join("\n"))}</textarea></label>
        </div>
      </div>
    `;
  }

  function addStage() {
    const synced = syncDraftFromDom(root, draft);
    if (!synced) return;
    const next = synced.stage_definitions.length + 1;
    synced.stage_definitions.push({ key: `stage-${next}`, title: `Stage ${next}`, sequence: next, input_description: "", output_description: "", acceptance_focus: [], roles: [{ name: "执行者", snail_template_id: getTemplates()[0]?.id || "", is_primary: true, description: "", working_rules: [] }] });
    render();
  }

  function addRole(stageIndex) {
    const synced = syncDraftFromDom(root, draft);
    if (!synced) return;
    synced.stage_definitions[stageIndex].roles.push({ name: "协作者", snail_template_id: getTemplates()[0]?.id || "", is_primary: synced.stage_definitions[stageIndex].roles.length === 0, description: "", working_rules: [] });
    render();
  }

  function handleClick(event) {
    const action = event.target.closest("[data-workspace-config-action]")?.dataset.workspaceConfigAction;
    if (!action) return;
    if (action === "cancel") { clear(); onCancel(); return; }
    if (action === "submit") { const synced = syncDraftFromDom(root, draft); onSubmit(synced, validateDraft(synced)); return; }
    if (action === "add-stage") { addStage(); return; }
    const stageIndex = Number(event.target.dataset.stageIndex);
    const roleIndex = Number(event.target.dataset.roleIndex);
    const synced = syncDraftFromDom(root, draft);
    if (!synced) return;
    if (action === "remove-stage" && synced.stage_definitions.length > 1) synced.stage_definitions.splice(stageIndex, 1);
    if (action === "add-role") addRole(stageIndex);
    if (action === "remove-role" && synced.stage_definitions[stageIndex].roles.length > 1) synced.stage_definitions[stageIndex].roles.splice(roleIndex, 1);
    render();
  }

  function handleChange(event) {
    if (!event.target.matches('[data-role-field="is_primary"]')) return;
    const synced = syncDraftFromDom(root, draft);
    if (!synced) return;
    const stageIndex = Number(event.target.dataset.stageIndex);
    const roleIndex = Number(event.target.dataset.roleIndex);
    synced.stage_definitions[stageIndex].roles.forEach((role, index) => { role.is_primary = index === roleIndex; });
  }

  root.addEventListener("click", handleClick);
  root.addEventListener("change", handleChange);

  return { start, render, clear, getDraft: () => draft };
}
