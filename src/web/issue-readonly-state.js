export function isIssueArchived(issue) {
  return Boolean(issue && issue.closed_at);
}

export function applyIssueReadonlyState(input) {
  const { elements, state, canRestartIssueDevelopment } = input;
  const readonly = isIssueArchived(state.currentIssue);
  const readonlyTitle = "已归档 Issue 仅支持查看历史上下文";

  elements.input.disabled = readonly;
  elements.input.placeholder = readonly ? readonlyTitle : "输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role";
  elements.send.disabled = readonly || !state.currentConversation;
  if (elements.newConversation) {
    elements.newConversation.disabled = readonly || !state.currentIssue || !state.currentStage;
    elements.newConversation.title = readonly ? readonlyTitle : "在当前阶段创建新对话";
  }
  if (elements.nextStage) {
    elements.nextStage.disabled = readonly || !state.currentIssue || !state.currentStage;
    elements.nextStage.title = readonly ? "已归档 Issue 不能推进阶段" : "推进当前 Issue 工作流";
  }
  if (elements.bounceStage) {
    elements.bounceStage.disabled = readonly || !canRestartIssueDevelopment(state.currentIssue, state.currentStage);
    elements.bounceStage.title = readonly ? "已归档 Issue 不能回退阶段" : elements.bounceStage.disabled ? "仅当前 Issue 的进行中阶段或已完成阶段可回退" : "在当前 Issue 下回退到前序阶段";
  }
}
