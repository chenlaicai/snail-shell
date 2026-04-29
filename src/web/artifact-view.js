export function renderArtifactTypeOptions(input) {
  const { artifactTypeSelect, currentStage, definitions, artifactTitle, readonly = false } = input;
  artifactTypeSelect.innerHTML = "";
  artifactTypeSelect.disabled = readonly;
  const types = currentStage ? (definitions[currentStage.type]?.formal_artifact_types || []) : [];
  if (types.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "无推荐类型";
    artifactTypeSelect.appendChild(option);
    return;
  }
  types.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = artifactTitle(type);
    artifactTypeSelect.appendChild(option);
  });
}

export function renderArtifactsView(input) {
  const { artifactList, artifacts, currentStage, artifactDefinitions, selectedFormalArtifactIds, artifactTitle, escapeHtml, readonly = false, onRendered } = input;
  artifactList.innerHTML = "";
  if (!currentStage) {
    artifactList.innerHTML = '<div class="empty-state">未选择阶段</div>';
    onRendered?.();
    return;
  }
  if (artifacts.length === 0) {
    artifactList.innerHTML = '<div class="empty-state">当前阶段还没有 artifact</div>';
    onRendered?.();
    return;
  }
  const formalSet = new Set(currentStage.formal_artifacts || []);
  artifacts.forEach((artifact) => artifactList.appendChild(createArtifactCard({ artifact, artifactDefinitions, formalSet, selectedFormalArtifactIds, artifactTitle, escapeHtml, readonly })));
  onRendered?.();
}

function createArtifactCard(input) {
  const { artifact, artifactDefinitions, formalSet, selectedFormalArtifactIds, artifactTitle, escapeHtml, readonly } = input;
  const card = document.createElement("div");
  card.className = "artifact-card";
  const checked = formalSet.has(artifact.id);
  const definition = artifactDefinitions[artifact.artifact_type];
  card.innerHTML = `
    <label style="display:flex; gap:8px; align-items:flex-start; cursor:pointer;">
      <input type="checkbox" data-artifact-id="${artifact.id}" ${checked ? "checked" : ""} ${readonly ? "disabled" : ""} style="width:auto; margin-top:4px;">
      <div style="flex:1;">
        <div class="name">${escapeHtml(artifact.title)}</div>
        <div class="meta">${escapeHtml(artifactTitle(artifact.artifact_type))} · ${escapeHtml(artifact.status)} · ${escapeHtml(artifact.storage_type)}</div>
        <div class="meta" style="margin-top: 6px;">${escapeHtml(definition?.description || "")}</div>
        <pre>${escapeHtml(artifact.inline_content || artifact.external_ref || artifact.file_path || "")}</pre>
      </div>
    </label>
  `;
  const checkbox = card.querySelector("input[type=checkbox]");
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedFormalArtifactIds.add(artifact.id);
    else selectedFormalArtifactIds.delete(artifact.id);
  });
  if (checked) selectedFormalArtifactIds.add(artifact.id);
  return card;
}
