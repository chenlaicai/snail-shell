import { marked } from "./vendor/marked.esm.js";

const ALLOWED_TAGS = new Set(["a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"]);
const ALLOWED_ATTRIBUTES = new Map([
  ["a", new Set(["href", "title"])],
  ["code", new Set(["class"])],
  ["td", new Set(["align"])],
  ["th", new Set(["align"])],
]);

let mermaidModulePromise = null;
let mermaidRenderSequence = 0;

marked.setOptions({
  breaks: true,
  gfm: true,
});

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = String(lang || "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") {
        return `<pre data-snail-fenced-code="mermaid"><code class="language-mermaid">${escapeHtml(text)}</code></pre>`;
      }
      return false;
    },
  },
});

export function renderMarkdownFragment(text) {
  /**
   * marked deliberately implements Markdown parsing, not HTML sanitization.
   * Assistant messages are untrusted UI input, so every parsed node must pass
   * through the whitelist copier before it can enter the live document.
   */
  const template = document.createElement("template");
  template.innerHTML = marked.parse(String(text || ""));
  const fragment = sanitizeMarkdownFragment(template.content);
  upgradeMermaidBlocks(fragment);
  return fragment;
}

export function sanitizeMarkdownFragment(fragment) {
  const safeFragment = document.createDocumentFragment();
  Array.from(fragment.childNodes).forEach((node) => appendSanitizedNode(safeFragment, node));
  return safeFragment;
}

function appendSanitizedNode(parent, node) {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(node.textContent || ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node;
  const tagName = element.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tagName)) {
    appendSanitizedText(parent, element);
    return;
  }

  const safeElement = document.createElement(tagName);
  copyAllowedAttributes(safeElement, element, tagName);
  Array.from(element.childNodes).forEach((child) => appendSanitizedNode(safeElement, child));
  parent.appendChild(safeElement);
}

function appendSanitizedText(parent, element) {
  const text = element.textContent || "";
  if (text) parent.appendChild(document.createTextNode(text));
}

function copyAllowedAttributes(target, source, tagName) {
  const allowed = ALLOWED_ATTRIBUTES.get(tagName);
  if (!allowed) return;
  Array.from(source.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (!allowed.has(name)) return;
    if (name === "href") {
      copySafeLinkAttributes(target, attribute.value);
      return;
    }
    if (tagName === "code" && name === "class") {
      copySafeCodeClass(target, source, attribute.value);
      return;
    }
    target.setAttribute(name, attribute.value);
  });
}

function copySafeCodeClass(target, source, className) {
  /**
   * Mermaid detection should come from Markdown fenced-code semantics, not from
   * arbitrary raw HTML classes. marked emits language-* on fenced code blocks;
   * only that exact diagram marker is needed by the renderer upgrade step.
   */
  const classes = String(className || "").split(/\s+/).filter(Boolean);
  const fencedCode = source.parentElement?.tagName.toLowerCase() === "pre" && source.parentElement.getAttribute("data-snail-fenced-code") === "mermaid";
  if (fencedCode && classes.includes("language-mermaid")) target.className = "language-mermaid";
}

function copySafeLinkAttributes(target, href) {
  const normalized = href.trim();
  /**
   * Markdown links are useful in final answers, but arbitrary URL schemes would
   * let model output create scriptable links. Keep only browser-navigation
   * schemes that are expected in conversation content.
   */
  if (!/^(https?:|mailto:|#)/i.test(normalized)) return;
  target.setAttribute("href", normalized);
  if (!normalized.startsWith("#")) {
    target.setAttribute("target", "_blank");
    target.setAttribute("rel", "noopener noreferrer");
  }
}

function upgradeMermaidBlocks(fragment) {
  Array.from(fragment.querySelectorAll("pre > code.language-mermaid")).forEach((code) => {
    const pre = code.parentElement;
    if (!pre) return;
    const source = code.textContent || "";
    const diagram = document.createElement("div");
    diagram.className = "mermaid-diagram";
    diagram.dataset.mermaidSource = source;
    diagram.setAttribute("role", "img");
    diagram.setAttribute("aria-label", "Mermaid diagram");
    const status = document.createElement("div");
    status.className = "mermaid-diagram-status";
    status.textContent = "Rendering Mermaid diagram...";
    diagram.appendChild(status);
    pre.replaceWith(diagram);
    renderMermaidDiagram(diagram, source);
  });
}

function renderMermaidDiagram(container, source) {
  if (!source.trim()) {
    showMermaidFallback(container, source, "Mermaid diagram is empty.");
    return;
  }
  getMermaidModule()
    .then((mermaid) => mermaid.render(`snail-mermaid-${++mermaidRenderSequence}`, source))
    .then(({ svg }) => {
      container.innerHTML = svg;
    })
    .catch((error) => {
      showMermaidFallback(container, source, error instanceof Error ? error.message : "Mermaid diagram failed to render.");
    });
}

function getMermaidModule() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("./vendor/mermaid.esm.min.mjs").then((module) => {
      const mermaid = module.default;
      /**
       * Mermaid returns SVG markup, so rendering must stay behind Mermaid's own
       * strict security mode and explicit invocation instead of auto-starting on
       * arbitrary DOM content.
       */
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
      return mermaid;
    });
  }
  return mermaidModulePromise;
}

function showMermaidFallback(container, source, message) {
  container.textContent = "";
  const title = document.createElement("div");
  title.className = "mermaid-diagram-error";
  title.textContent = message;
  const code = document.createElement("pre");
  const codeText = document.createElement("code");
  codeText.textContent = source;
  code.appendChild(codeText);
  container.append(title, code);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
