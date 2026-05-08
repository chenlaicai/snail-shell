export function isFeatureArchived(feature) {
  return feature?.status === "archived";
}

export function applyFeatureReadonlyState(input) {
  const { elements, state, canRestartFeatureDevelopment } = input;
  const readonly = isFeatureArchived(state.currentFeature);
  const readonlyTitle = "已归档 Feature 仅支持查看历史上下文";

  elements.input.disabled = readonly;
  elements.input.placeholder = readonly ? readonlyTitle : "输入 @Design Snail 与指定 snail 对话；未指定时默认发送给当前主 snail";
  elements.send.disabled = readonly || !state.currentConversation;
  if (elements.newConversation) {
    elements.newConversation.disabled = readonly || !state.currentFeature || !state.currentStage;
    elements.newConversation.title = readonly ? readonlyTitle : "在当前阶段创建新对话";
  }
  elements.createArtifact.disabled = readonly || !state.currentConversation || !state.currentStage;
  elements.createArtifact.title = readonly ? readonlyTitle : "创建当前对话的 Artifact";
  elements.setFormalArtifact.disabled = readonly || !state.currentStage;
  elements.setFormalArtifact.title = readonly ? readonlyTitle : "更新当前阶段的正式交付";
  elements.nextStage.disabled = readonly || !state.currentFeature || !state.currentStage;
  elements.nextStage.title = readonly ? "已归档 Feature 不能推进阶段" : "推进当前 Feature 工作流";
  elements.restartDevelopment.disabled = readonly || !canRestartFeatureDevelopment(state.currentFeature, state.currentStage);
  elements.restartDevelopment.title = readonly ? "已归档 Feature 不能开启新研发迭代" : elements.restartDevelopment.disabled ? "仅当前 Feature 的进行中研发或等待合入的检视阶段可返工" : "在当前 Feature 下开启新研发迭代";
}
