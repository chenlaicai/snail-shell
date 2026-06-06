/**
 * MarkdownRenderer - React 版 Markdown 渲染
 *
 * 基于 marked + GFM + HTML 消毒 + Mermaid 图表支持。
 */

import { marked } from "marked";
import { MermaidDiagram } from "./MermaidDiagram";

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

  if (!(node instanceof Element)) { node.remove(); return; }
  const el = node;
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    const text = document.createTextNode(el.textContent || "");
    el.replaceWith(text);
    return;
  }

  const allowed = ALLOWED_ATTRIBUTES[tag];
  Array.from(el.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    if (!allowed || !allowed.has(name)) {
      el.removeAttribute(attr.name);
      return;
    }
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

  Array.from(el.childNodes).forEach((child) => sanitizeNode(child));
}

/** 渲染 Markdown 文本为 HTML 字符串 */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const rawHtml = marked.parse(text) as string;
  return sanitizeHtml(rawHtml);
}

/** 从 Markdown 中提取 mermaid 代码块 */
function extractMermaidBlocks(text: string): { before: string; mermaid: string; after: string }[] {
  const parts: { before: string; mermaid: string; after: string }[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    parts.push({
      before: text.slice(lastIndex, match.index),
      mermaid: match[1].trim(),
      after: "",
    });
    lastIndex = match.index + match[0].length;
  }

  if (parts.length > 0) {
    parts[parts.length - 1].after = text.slice(lastIndex);
  }

  return parts;
}

/** React 组件：渲染 Markdown 内容（支持 Mermaid 图表） */
export function MarkdownView({ text }: { text: string }) {
  if (!text) return null;

  const mermaidBlocks = extractMermaidBlocks(text);

  // 没有 mermaid 块，直接渲染
  if (mermaidBlocks.length === 0) {
    const html = renderMarkdown(text);
    return <div className="msg-markdown leading-[1.6]" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // 有 mermaid 块，分段渲染
  return (
    <div className="msg-markdown leading-[1.6]">
      {mermaidBlocks.map((block, i) => (
        <div key={i}>
          {block.before && <div dangerouslySetInnerHTML={{ __html: renderMarkdown(block.before) }} />}
          <MermaidDiagram source={block.mermaid} />
          {block.after && <div dangerouslySetInnerHTML={{ __html: renderMarkdown(block.after) }} />}
        </div>
      ))}
    </div>
  );
}
