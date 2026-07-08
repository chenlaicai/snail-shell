import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";

const MARKED_OPTIONS = { gfm: true, breaks: true } as const;

const ALLOWED_TAGS = new Set([
  "a", "blockquote", "br", "code", "del", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "input", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  code: new Set(["class"]),
  input: new Set(["type", "disabled", "checked"]),
  td: new Set(["align"]),
  th: new Set(["align"]),
};

export function RichTextRenderer({ content }: { content: string }) {
  /**
   * 增量解析：streaming 期间 content 频繁追加，缓存前 N-1 个 block，
   * 只对最后一个 block（可能包含新增内容）重新执行 marked.parse + sanitizeHtml。
   * 前提：前端 block 已闭合，不会因后续内容改变解析结果。
   */
  const cacheRef = useRef({
    content: "",
    blocks: [] as Array<{ type: "markdown" | "mermaid"; content: string }>,
  });

  const blocks = useMemo(() => {
    const cached = cacheRef.current;
    let result: Array<{ type: "markdown" | "mermaid"; content: string }>;
    if (content.startsWith(cached.content) && cached.blocks.length > 0) {
      result = incrementalSplitMermaidBlocks(content, cached.content, cached.blocks);
    } else {
      /** 非增量（内容截断/重写）：全量重新解析 */
      result = splitMermaidBlocks(content);
    }
    cacheRef.current = { content, blocks: result };
    return result;
  }, [content]);

  return (
    <div className="space-y-3 text-text-primary">
      {blocks.map((block, index) => block.type === "mermaid"
        ? <MermaidBlock key={index} code={block.content} />
        : <MarkdownBlock key={index} content={block.content} />
      )}
    </div>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content, MARKED_OPTIONS) as string, [content]);
  const safeHtml = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <div
      className="max-w-none text-[13px] leading-6 text-text-primary overflow-x-auto [&_a]:text-shell-400 [&_a]:no-underline hover:[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-shell-400/40 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_code]:bg-white/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-shell-300 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h5]:text-sm [&_h5]:font-medium [&_h5]:mt-3 [&_h5]:mb-1.5 [&_h6]:text-xs [&_h6]:font-medium [&_h6]:mt-3 [&_h6]:mb-1.5 [&_hr]:border-white/10 [&_hr]:my-4 [&_input]:mr-1.5 [&_li]:my-1 [&_li:has(input)]:list-none [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-white/6 [&_pre]:bg-surface-0 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-white/10 [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-white/10 [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-surface-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    render();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return <pre className="overflow-x-auto rounded-lg border border-status-red/30 bg-status-red/10 p-3 text-[12px] text-status-red">{code}</pre>;
  }
  return <div ref={ref} className="overflow-x-auto rounded-lg border border-white/6 bg-surface-0 p-3" />;
}

function splitMermaidBlocks(input: string): Array<{ type: "markdown" | "mermaid"; content: string }> {
  const blocks: Array<{ type: "markdown" | "mermaid"; content: string }> = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input))) {
    if (match.index > last) blocks.push({ type: "markdown", content: input.slice(last, match.index) });
    blocks.push({ type: "mermaid", content: match[1].trim() });
    last = regex.lastIndex;
  }
  if (last < input.length) blocks.push({ type: "markdown", content: input.slice(last) });
  return blocks.length > 0 ? blocks : [{ type: "markdown", content: input }];
}

/**
 * 增量拆分：新内容以旧内容为前缀时，复用前 N-1 个 block，只对最后一个 block 重新拆分。
 * 当 block 数量变化（新内容产生了新 block）时，追加新 block 到缓存。
 */
function incrementalSplitMermaidBlocks(
  newContent: string,
  cachedContent: string,
  cachedBlocks: Array<{ type: "markdown" | "mermaid"; content: string }>,
): Array<{ type: "markdown" | "mermaid"; content: string }> {
  /** 计算新内容中的 block 数量，判断是否可增量复用 */
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let last = 0;
  let blockCount = 0;
  while (regex.exec(newContent)) {
    blockCount++;
    last = regex.lastIndex;
  }
  if (last < newContent.length) blockCount++;

  if (blockCount <= cachedBlocks.length) {
    const lastCached = cachedBlocks[cachedBlocks.length - 1];
    if (lastCached.type === "markdown") {
      /** block 数未变且尾部是 markdown：直接追加 tail */
      const result = cachedBlocks.slice(0, cachedBlocks.length - 1);
      const tailContent = newContent.slice(cachedContent.length);
      result.push({ type: "markdown", content: lastCached.content + tailContent });
      return result;
    }
    // 尾部是 mermaid：tail 一定是新 block 的开始，走全量重建
  }

  /** block 数增加：从缓存重建完整内容后全量拆分（缓存的 mermaid block 不含 fence，需还原） */
  const fullCached = cachedBlocks.map(b =>
    b.type === "mermaid" ? "```mermaid\n" + b.content + "\n```" : b.content,
  ).join("");
  const tail = newContent.slice(cachedContent.length);
  return splitMermaidBlocks(fullCached + tail);
}

function sanitizeHtml(html: string): string {
  if (!html) return "";
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

function sanitizeNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) return;
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    Array.from(node.childNodes).forEach((child) => sanitizeNode(child));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.remove();
    return;
  }

  if (!(node instanceof Element)) {
    node.remove();
    return;
  }

  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    const text = document.createTextNode(node.textContent || "");
    node.replaceWith(text);
    return;
  }

  /** input 标签仅允许 type=checkbox，其余 type 值或缺失 type 时移除整个节点 */
  if (tag === "input") {
    const typeAttr = node.getAttribute("type");
    if (!typeAttr || typeAttr.toLowerCase() !== "checkbox") {
      node.remove();
      return;
    }
    /** B-12: 强制 disabled，确保 checkbox 不可交互 */
    node.setAttribute("disabled", "");
  }

  const allowed = ALLOWED_ATTRIBUTES[tag];
  Array.from(node.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (!allowed || !allowed.has(name)) {
      node.removeAttribute(attribute.name);
      return;
    }
    if (name === "href") {
      const href = attribute.value.trim();
      if (!/^(https?:|mailto:|#)/i.test(href)) {
        node.removeAttribute("href");
      } else if (!href.startsWith("#")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
  });

  Array.from(node.childNodes).forEach((child) => sanitizeNode(child));
}
