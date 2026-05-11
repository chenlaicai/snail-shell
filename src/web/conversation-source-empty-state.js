export function renderConversationSourceEmptyState(container, input) {
  const { currentConversation, sources, messageState, onSelectSourceConversation } = input;
  if (!currentConversation || messageState.records.length > 0 || sources.length === 0) return;
  const sourceList = document.createElement("div");
  sourceList.className = "empty-state conversation-source-empty-state";
  sourceList.innerHTML = `
    <div>当前 conversation 还没有消息。</div>
    <div>它是从上一阶段 conversation 承接而来，可以打开来源对话查看上下文：</div>
  `;
  sources.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button conversation-source-link";
    button.textContent = conversation.title;
    button.addEventListener("click", () => onSelectSourceConversation(conversation.id));
    sourceList.appendChild(button);
  });
  container.appendChild(sourceList);
}
