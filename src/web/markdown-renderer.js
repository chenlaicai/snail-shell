import { marked } from "./vendor/marked.esm.js";

const ALLOWED_TAGS = new Set(["a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"]);
const ALLOWED_ATTRIBUTES = new Map([
  ["a", new Set(["href", "title"])],
  ["td", new Set(["align"])],
  ["th", new Set(["align"])],
]);

const template = document.createElement("template");

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdownFragment(text) {
  /**
   * marked deliberately implements Markdown parsing, not HTML sanitization.
   * Assistant messages are untrusted UI input, so every parsed node must pass
   * through the whitelist copier before it can enter the live document.
   */
  template.innerHTML = marked.parse(String(text || ""));
  return sanitizeMarkdownFragment(template.content);
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
    target.setAttribute(name, attribute.value);
  });
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
