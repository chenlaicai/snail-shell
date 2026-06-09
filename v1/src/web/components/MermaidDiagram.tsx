/**
 * MermaidDiagram - Mermaid 图表渲染组件
 *
 * 使用 mermaid 库渲染流程图、序列图等。
 * 只在浏览器端动态加载 mermaid。
 */

import { useEffect, useRef, useState } from "react";

let mermaidInstance: unknown = null;
let mermaidLoadPromise: Promise<unknown> | null = null;

async function loadMermaid() {
  if (mermaidInstance) return mermaidInstance;
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = import("mermaid").then((module) => {
    const mermaid = module.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
    mermaidInstance = mermaid;
    return mermaid;
  });
  return mermaidLoadPromise;
}

// Mermaid 图表类型检测
const MERMAID_DIAGRAM_START = /^\s*(%%[^\n]*\n|\s*\n)*\s*(graph\b|flowchart\b|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|gantt\b|pie\b|gitGraph\b|journey\b|quadrantChart\b|xychart\b|requirement(Diagram)?\b|mindmap\b|timeline\b|sankey\b|block\b|packet\b|architecture\b|kanban\b|C4(Context|Container|Component|Dynamic|Deployment)\b|radar-beta\b|treeView-beta\b|venn-beta\b|wardley-beta\b|treemap\b|ishikawa\b|flowchart-elk\b|info\b)/m;

function isMermaidSource(source: string): boolean {
  return MERMAID_DIAGRAM_START.test(source);
}

let renderSequence = 0;

export function MermaidDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "rendered" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!source.trim() || !isMermaidSource(source)) {
      setStatus("error");
      setErrorMsg("不是有效的 Mermaid 图表");
      return;
    }

    let cancelled = false;

    async function render() {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        const id = `snail-mermaid-${++renderSequence}`;
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setStatus("rendered");
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Mermaid 渲染失败");
      }
    }

    render();
    return () => { cancelled = true; };
  }, [source]);

  if (status === "loading") {
    return (
      <div className="p-[var(--space-md)] text-center text-[var(--color-text-muted)] text-[var(--font-size-sm)]">
        渲染 Mermaid 图表...
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-[var(--space-md)]">
        <div className="text-[var(--color-danger-text)] mb-[var(--space-sm)] text-[var(--font-size-sm)]">{errorMsg}</div>
        <pre className="text-[var(--font-size-xs)] bg-[var(--color-bg-deep)] p-[var(--space-md)] rounded-[var(--radius-sm)] overflow-auto">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="p-[var(--space-md)] [&_svg]:max-w-full" />;
}
