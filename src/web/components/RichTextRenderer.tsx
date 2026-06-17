import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";

const MARKED_OPTIONS = { gfm: true, breaks: true } as const;

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

export function RichTextRenderer({ content }: { content: string }) {
  const blocks = useMemo(() => splitMermaidBlocks(content), [content]);

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
      className="max-w-none text-[13px] leading-6 text-text-primary [&_a]:text-shell-400 [&_a]:no-underline hover:[&_a]:underline [&_code]:text-shell-300 [&_li]:my-1 [&_ol]:my-2 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-white/6 [&_pre]:bg-surface-0 [&_pre]:p-3 [&_ul]:my-2"
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
