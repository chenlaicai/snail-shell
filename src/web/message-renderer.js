import { buildMessageView, escapeHtml } from "./message-view.js";

function buildHeader(view) {
  return `<div class="msg-header"><div class="role">${escapeHtml(view.speaker || view.role)}</div><div class="timestamp">${escapeHtml(view.timestamp)}</div></div>`;
}

function buildQuestionMessage(payload, messageKey, onSubmitQuestion) {
  const wrapper = document.createElement("div");
  wrapper.className = "question";
  const options = Array.isArray(payload.options) ? payload.options : [];
  const selectionType = payload.selection_mode === "multiple" ? "checkbox" : "radio";
  const inputName = `question-${messageKey}`;
  const selectionHint = payload.selection_mode === "multiple" ? "可多选" : "单选";
  wrapper.innerHTML = `
    <div class="question-title">${escapeHtml(payload.title || "需要你的确认")}</div>
    <div class="question-body">${escapeHtml(payload.question || "")}</div>
    ${payload.reason ? `<div class="question-reason">${escapeHtml(payload.reason)}</div>` : ""}
    <form class="question-form"></form>
  `;
  const form = wrapper.querySelector(".question-form");
  const toolbar = document.createElement("div");
  toolbar.className = "question-toolbar";
  toolbar.innerHTML = `
    <div class="question-selection-hint">${selectionHint}</div>
    <div class="question-selection-count">尚未选择</div>
  `;
  form.appendChild(toolbar);

  const optionsContainer = document.createElement("div");
  optionsContainer.className = "question-options";
  options.forEach((option, index) => {
    const optionId = `q-${messageKey}-${index}`;
    const item = document.createElement("div");
    item.className = "question-option";
    const label = document.createElement("label");
    label.className = "question-option-label";
    label.htmlFor = optionId;

    const input = document.createElement("input");
    input.id = optionId;
    input.type = selectionType;
    input.name = inputName;
    input.value = option.key;
    label.appendChild(input);

    const textWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "question-option-title";
    title.textContent = option.label;
    textWrap.appendChild(title);
    if (option.description) {
      const description = document.createElement("div");
      description.className = "question-option-description";
      description.textContent = option.description;
      textWrap.appendChild(description);
    }
    label.appendChild(textWrap);
    item.appendChild(label);

    if (option.allow_text_input) {
      const textarea = document.createElement("textarea");
      textarea.className = "question-option-extra";
      textarea.rows = 2;
      textarea.dataset.optionText = option.key;
      textarea.placeholder = option.text_input_placeholder || option.text_input_label || "补充说明";
      item.appendChild(textarea);
    }
    optionsContainer.appendChild(item);
  });
  form.appendChild(optionsContainer);

  const actionRow = document.createElement("div");
  actionRow.className = "button-row question-actions";
  actionRow.innerHTML = `<button type="submit" class="secondary-button question-submit" disabled>提交回答</button>`;
  form.appendChild(actionRow);

  const countBadge = form.querySelector(".question-selection-count");
  const submitButton = form.querySelector(".question-submit");

  function syncQuestionSelectionState() {
    const selectedInputs = Array.from(form.querySelectorAll(`input[name="${inputName}"]:checked`));
    const selectedCount = selectedInputs.length;
    countBadge.textContent = selectedCount
      ? (payload.selection_mode === "multiple" ? `已选 ${selectedCount} 项` : "已选择")
      : "尚未选择";
    submitButton.disabled = selectedCount === 0;
  }

  form.addEventListener("change", () => syncQuestionSelectionState());
  syncQuestionSelectionState();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedInputs = Array.from(form.querySelectorAll(`input[name="${inputName}"]:checked`));
    if (!selectedInputs.length) return;
    submitButton.disabled = true;
    submitButton.textContent = "提交中...";
    const selectedOptions = selectedInputs.map((input) => {
      const option = options.find((item) => item.key === input.value);
      const textArea = form.querySelector(`textarea[data-option-text="${CSS.escape(input.value)}"]`);
      return {
        key: option?.key || input.value,
        label: option?.label || input.value,
        extra_text: textArea ? textArea.value.trim() : "",
      };
    });
    const summary = selectedOptions.map((option) => `${option.label}${option.extra_text ? `（${option.extra_text}）` : ""}`).join("；");
    const responsePayload = {
      format: "blocks",
      fallback_text: summary,
      blocks: [{
        type: "question_response",
        response_to: {
          title: payload.title || "",
        },
        selection_mode: payload.selection_mode || "single",
        selected_options: selectedOptions,
        summary,
      }],
    };
    try {
      await onSubmitQuestion(summary, responsePayload);
    } finally {
      submitButton.textContent = "提交回答";
      syncQuestionSelectionState();
    }
  });

  return wrapper;
}

function appendBlocks(shell, view, handlers) {
  view.blocks.forEach((block) => {
    const node = createBlockNode(block, view, handlers);
    if (node) shell.appendChild(node);
  });
}

function createBlockNode(block, view, handlers) {
  switch (block.kind) {
    case "quote":
      return createQuoteBlock(block);
    case "placeholder":
      return createTextLikeBlock(block.text);
    case "question":
      return buildQuestionMessage(block.payload, view.key, handlers.onSubmitQuestion);
    case "event_activity":
      return createEventActivityBlock(block);
    case "text_event":
      return createTextEventBlock(block.text, view.role);
    case "markdown":
      return createMarkdownBlock(block.text, view.role);
    case "image":
      return createImageBlock(block);
    case "icon":
      return createCardBlock("Icon", block.label || block.name, block.name ? `name: ${block.name}` : "");
    case "chart":
      return createCardBlock(`Chart · ${block.chartType}`, block.title || "未命名图表", block.data ? JSON.stringify(block.data, null, 2) : "");
    case "table":
      return createTableBlock(block);
    case "tool_call_card":
      return createCardBlock(`Tool · ${block.status || "done"}`, block.toolName, [block.summary, block.detail].filter(Boolean).join("\n\n"));
    case "artifact_card":
      return createArtifactCardBlock(block);
    case "reference_card":
      return createReferenceCardBlock(block);
    case "error":
      return createTextLikeBlock(`Error: ${block.text}`);
    default:
      return null;
  }
}

function createQuoteBlock(block) {
  const quote = document.createElement("div");
  quote.className = "quote-block";
  quote.textContent = block.text;
  return quote;
}

function createTextLikeBlock(text) {
  const node = document.createElement("div");
  node.className = "assistant-part";
  node.textContent = text;
  return node;
}

function createEventActivityBlock(block) {
  if (!block.detail) {
    const node = document.createElement("div");
    node.className = eventActivityClassName(block);
    node.textContent = block.label;
    return node;
  }

  const details = document.createElement("details");
  details.className = eventActivityClassName(block);
  const summary = document.createElement("summary");
  summary.textContent = block.label;
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "message-event-activity-detail";
  body.textContent = block.detail;
  details.appendChild(body);
  return details;
}

function eventActivityClassName(block) {
  return `message-event-activity ${block.tone === "error" ? "error" : ""}`.trim();
}

function createTextEventBlock(text, role) {
  const textBlock = document.createElement("div");
  textBlock.className = role === "assistant" ? "message-event-text" : "assistant-part";
  if (role === "assistant") {
    textBlock.innerHTML = `<div class="message-event-label">text event</div><div class="assistant-part">${escapeHtml(text)}</div>`;
  } else {
    textBlock.textContent = text;
  }
  return textBlock;
}

function createMarkdownBlock(text, role) {
  const wrapper = document.createElement("div");
  wrapper.className = role === "assistant" ? "message-card markdown-block" : "assistant-part markdown-block";
  if (role === "assistant") {
    wrapper.innerHTML = `<div class="message-card-header"><span>Markdown</span></div><div class="message-card-body"></div>`;
    wrapper.querySelector(".message-card-body").appendChild(renderMarkdownBody(text));
    return wrapper;
  }
  wrapper.appendChild(renderMarkdownBody(text));
  return wrapper;
}

function renderMarkdownBody(text) {
  const container = document.createElement("div");
  const lines = String(text || "").split("\n");
  let list = null;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      list = null;
      return;
    }
    if (trimmed.startsWith("# ") || trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      list = null;
      const level = trimmed.startsWith("### ") ? "h3" : (trimmed.startsWith("## ") ? "h2" : "h1");
      const heading = document.createElement(level);
      heading.textContent = trimmed.replace(/^#+\s*/, "");
      container.appendChild(heading);
      return;
    }
    if (trimmed.startsWith("- ")) {
      if (!list || list.tagName !== "UL") {
        list = document.createElement("ul");
        container.appendChild(list);
      }
      const item = document.createElement("li");
      item.textContent = trimmed.slice(2);
      list.appendChild(item);
      return;
    }
    if (trimmed.startsWith("> ")) {
      list = null;
      const quote = document.createElement("blockquote");
      quote.textContent = trimmed.slice(2);
      container.appendChild(quote);
      return;
    }
    if (trimmed.startsWith("```") && trimmed.endsWith("```") && trimmed.length > 6) {
      list = null;
      const pre = document.createElement("pre");
      pre.textContent = trimmed.slice(3, -3).trim();
      container.appendChild(pre);
      return;
    }
    list = null;
    const paragraph = document.createElement("p");
    paragraph.textContent = trimmed;
    container.appendChild(paragraph);
  });
  return container;
}

function createImageBlock(block) {
  const imageBlock = document.createElement("div");
  imageBlock.className = "message-card";
  imageBlock.innerHTML = `<div class="message-card-header"><span>Image</span><span class="message-card-meta">external</span></div><div class="message-card-body"></div>`;
  const body = imageBlock.querySelector(".message-card-body");
  const link = document.createElement("a");
  link.href = block.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = block.alt || block.url;
  body.appendChild(link);
  return imageBlock;
}

function createTableBlock(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-card table-block";
  wrapper.innerHTML = `<div class="message-card-header"><span>${escapeHtml(block.title || "Table")}</span><span class="message-card-meta">${block.columns.length} columns</span></div><div class="message-card-body"></div>`;
  const body = wrapper.querySelector(".message-card-body");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  block.columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  block.rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell === null ? "" : String(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);
  return wrapper;
}

function createArtifactCardBlock(block) {
  return createCardBlock(
    `Artifact${block.artifactType ? ` · ${block.artifactType}` : ""}`,
    block.title,
    [block.summary, block.status ? `status: ${block.status}` : "", block.artifactId ? `id: ${block.artifactId}` : ""].filter(Boolean).join("\n")
  );
}

function createReferenceCardBlock(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-card";
  wrapper.innerHTML = `<div class="message-card-header"><span>Reference · ${escapeHtml(block.refType)}</span>${block.refId ? `<span class="message-card-meta">${escapeHtml(block.refId)}</span>` : ""}</div><div class="message-card-body"></div>`;
  const body = wrapper.querySelector(".message-card-body");
  if (block.href) {
    const link = document.createElement("a");
    link.href = block.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = block.title;
    body.appendChild(link);
    if (block.summary) {
      const summary = document.createElement("div");
      summary.className = "message-card-meta";
      summary.style.marginTop = "8px";
      summary.textContent = block.summary;
      body.appendChild(summary);
    }
    return wrapper;
  }
  body.textContent = `${block.title}${block.summary ? `\n${block.summary}` : ""}`;
  return wrapper;
}

function createCardBlock(label, title, detail) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-card";
  wrapper.innerHTML = `<div class="message-card-header"><span>${escapeHtml(label)}</span></div><div class="message-card-body"><div>${escapeHtml(title)}</div>${detail ? `<div class="message-card-meta" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(detail)}</div>` : ""}</div>`;
  return wrapper;
}

function appendActions(shell, view, handlers) {
  if (!view.messageId) return;
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const replyButton = document.createElement("button");
  replyButton.type = "button";
  replyButton.className = "msg-action";
  replyButton.textContent = "回复";
  replyButton.addEventListener("click", () => handlers.onReply(view.messageId));
  actions.appendChild(replyButton);
  shell.appendChild(actions);
}

export function renderMessages(container, messageState, handlers) {
  const fragment = document.createDocumentFragment();
  messageState.records.forEach((record) => {
    const view = buildMessageView(record, messageState.byPersistedId);
    if (!view.blocks.length) return;
    const shell = document.createElement("div");
    const classes = ["msg", view.role];
    if (view.role === "assistant") classes.push("message-shell");
    if (view.status === "thinking" || view.status === "pending") classes.push("loading");
    if (view.blocks.some((block) => block.kind === "question")) classes.push("question");
    shell.className = classes.join(" ");
    shell.innerHTML = buildHeader(view);
    if (view.messageId) {
      shell.dataset.messageId = String(view.messageId);
    }
    appendBlocks(shell, view, handlers);
    appendActions(shell, view, handlers);
    fragment.appendChild(shell);
  });
  container.innerHTML = "";
  container.appendChild(fragment);
}
