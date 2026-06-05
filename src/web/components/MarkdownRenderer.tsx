/**
 * MarkdownRenderer - React 版 Markdown 渲染
 *
 * 基于原 markdown-renderer.js，使用 marked + GFM + HTML 消毒。
 * Mermaid 支持暂不实现（需要额外依赖），后续补充。
 */

import { marked } from "marked";

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

const ALLOWED_TAGS = new Set([
  "a", "blockquote", "br", "code", "del", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  code: new Set(["class"]),
  td: new Set(["align"]),
  th: new Set(["align"]),
};

/** 消毒 HTML：只保留白名单标签和属性 */
function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

function sanitizeNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) return;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.remove();
    return;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // 不在白名单的标签：保留文本内容，移除标签
    const text = document.createTextNode(el.textContent || "");
    el.replaceWith(text);
    return;
  }

  // 清除不允许的属性
  const allowed = ALLOWED_ATTRIBUTES[tag];
  Array.from(el.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    if (!allowed || !allowed.has(name)) {
      el.removeAttribute(attr.name);
      return;
    }
    // 链接安全处理
    if (name === "href") {
      const href = attr.value.trim();
      if (!/^(https?:|mailto:|#)/i.test(href)) {
        el.removeAttribute("href");
      } else if (!href.startsWith("#")) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
  });

  // 递归处理子节点
  Array.from(el.childNodes).forEach((child) => sanitizeNode(child));
}

/** 渲染 Markdown 文本为 HTML 字符串 */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const rawHtml = marked.parse(text) as string;
  return sanitizeHtml(rawHtml);
}

/** React 组件：渲染 Markdown 内容 */
export function MarkdownView({ text }: { text: string }) {
  if (!text) return null;
  const html = renderMarkdown(text);
  return <div className="msg-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
