/**
 * 渲染 Feature Context 卡片。展示 stage.output_artifacts 的完整 map，
 * 不再硬编码 branch_name/worktree_path/pr_url 三个字段。
 *
 * 当 output_artifacts 为空时，醒目提示缺少产物会导致阶段无法推进。
 */
export function renderRepoContextCard(input) {
  const { card, editButton, stage, readonly, escapeHtml, api, onUpdated, showNotice } = input;
  if (!card) return;

  if (!stage) {
    card.innerHTML = `
      <div class="feature-context-empty">
        <div class="meta">选择 Stage 后查看 Feature 上下文产物。</div>
      </div>
    `;
    if (editButton) editButton.disabled = true;
    return;
  }

  const artifacts = getArtifactsRecord(stage);
  const entries = Object.entries(artifacts);
  const empty = entries.length === 0;
  const pills = entries.map(([key, value]) => `
    <div class="deliverable-pill output" title="${escapeHtml(`${key}: ${value}`)}">
      <span class="artifact-key">${escapeHtml(key)}</span>
      <span class="artifact-sep">：</span>
      <span class="artifact-value">${escapeHtml(value)}</span>
      ${!readonly ? `<button class="deliverable-remove" data-remove-artifact="${escapeHtml(key)}" aria-label="移除 ${escapeHtml(key)}">×</button>` : ""}
    </div>
  `).join("");

  card.innerHTML = `
    <div class="feature-context-pills">${pills || '<div class="feature-context-warning">⚠ 缺少输出产物——当前阶段无法推进。研发者需在执行 record-feature-repo-context skill 后在此填写分支、worktree 和 PR。</div>'}</div>
    <div class="meta" style="margin-top: 8px;">${empty ? "Stage 推进要求至少一个输出产物。完成/归档时仅清理此处记录且通过安全校验的仓库资源。" : "所有输出产物在此集中展示。完成/归档时仅清理记录且通过安全校验的仓库资源。"}</div>
    ${readonly ? "" : `<div class="artifact-add-row">
      <input type="text" class="artifact-input artifact-key-input" placeholder="键（如 worktree_path）" list="artifact-key-suggestions">
      <datalist id="artifact-key-suggestions">
        <option value="branch_name">
        <option value="worktree_path">
        <option value="pr_url">
      </datalist>
      <input type="text" class="artifact-input artifact-value-input" placeholder="值（如 /path/to/worktree）">
      <button class="artifact-add-btn" type="button">添加</button>
    </div>`}
  `;

  if (editButton) editButton.disabled = readonly;

  // 绑定添加按钮
  if (!readonly) {
    const keyInput = card.querySelector(".artifact-key-input");
    const valueInput = card.querySelector(".artifact-value-input");
    const addBtn = card.querySelector(".artifact-add-btn");
    if (addBtn && keyInput && valueInput) {
      addBtn.addEventListener("click", () => addOutputArtifact(keyInput, valueInput));
      valueInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addOutputArtifact(keyInput, valueInput); });
    }
  }

  // 绑定删除按钮
  card.querySelectorAll("[data-remove-artifact]").forEach((btn) => {
    btn.addEventListener("click", () => removeOutputArtifact(btn.getAttribute("data-remove-artifact")));
  });

  async function addOutputArtifact(keyElement, valueElement) {
    const key = keyElement.value.trim();
    const value = valueElement.value.trim();
    if (!key || !value || !stage) return;
    const current = getArtifactsRecord(stage);
    if (current[key] === value) {
      keyElement.value = "";
      valueElement.value = "";
      return;
    }
    current[key] = value;
    try {
      const updated = await api("PATCH", `/stages/${stage.id}`, { output_artifacts: current });
      onUpdated(updated);
      keyElement.value = ""; valueElement.value = "";
      showNotice?.("已记录输出产物「" + key + "」");
      /** PATCH 返回完整 stage，用最新数据重新渲染卡片，避免闭包 stage 过时导致下次操作覆盖前序产物 */
      renderRepoContextCard({ ...input, stage: updated });
    } catch (err) {
      showNotice?.(`记录失败：${err.message}`, true);
    }
  }

  async function removeOutputArtifact(key) {
    if (!stage) return;
    const current = getArtifactsRecord(stage);
    delete current[key];
    try {
      const updated = await api("PATCH", `/stages/${stage.id}`, { output_artifacts: current });
      onUpdated(updated);
      showNotice?.("已移除输出产物「" + key + "」");
      /** PATCH 返回完整 stage，用最新数据重新渲染卡片，避免闭包 stage 过时导致下次操作覆盖前序产物 */
      renderRepoContextCard({ ...input, stage: updated });
    } catch (err) {
      showNotice?.(`移除失败：${err.message}`, true);
    }
  }
}

/**
 * 编辑 Feature Context 已废弃——现在在卡片内直接添加/删除。
 * 保留此函数以兼容旧调用链（app.js 中的 onEditRepoContext）。
 */
export function editRepoContext(input) {
  const { stage, showNotice } = input;
  if (!stage) return;
  showNotice?.("请在 Feature Context 卡片中直接添加或删除输出产物。", false);
}

function getArtifactsRecord(stage) {
  const raw = stage.output_artifacts;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  return {};
}
