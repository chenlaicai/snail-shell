export function isFeatureArchived(feature) {
  return Boolean(feature && feature.closed_at);
}

export function applyFeatureReadonlyState(input) {
  const { elements, state, canTransitionFrom, transitions } = input;
  const readonly = isFeatureArchived(state.currentFeature);
  const readonlyTitle = "已归档 Feature 仅支持查看历史上下文";

  elements.input.disabled = readonly;
  elements.input.placeholder = readonly ? readonlyTitle : "输入 @研发者 与指定 role 对话；未指定时默认发送给当前主 role";
  elements.send.disabled = readonly || !state.currentConversation;
  if (elements.newConversation) {
    elements.newConversation.disabled = readonly || !state.currentFeature || !state.currentStage;
    elements.newConversation.title = readonly ? readonlyTitle : "在当前阶段创建新对话";
  }
  if (elements.nextStage) {
    elements.nextStage.disabled = readonly || !state.currentFeature || !state.currentStage;
    elements.nextStage.title = readonly ? "已归档 Feature 不能推进阶段" : "推进当前 Feature 工作流";
  }
  if (elements.bounceStage) {
    elements.bounceStage.disabled = readonly || !canTransitionFrom(state.currentFeature, state.currentStage, transitions);
    elements.bounceStage.title = readonly ? "已归档 Feature 不能回退阶段" : elements.bounceStage.disabled ? "当前阶段无可用转移" : "在当前 Feature 下转移到其他阶段";
  }
}
