import path from "path";
import { parseHTML } from "linkedom";

const { document, Node } = parseHTML("<!doctype html><html><body></body></html>");

Object.assign(globalThis, { document, Node });

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importWebModule<T>(relativePath: string): Promise<T> {
  const moduleUrl = `file://${path.resolve(__dirname, relativePath)}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<T>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { parseMarkdownTable } = await importWebModule<{ parseMarkdownTable: (lines: string[], startIndex: number) => { headers: string[]; rows: string[][]; endIndex: number } | null }>("../../src/web/markdown-table.js");
  const { renderMarkdownFragment } = await importWebModule<{
    renderMarkdownFragment: (text: string) => {
      querySelector: (selector: string) => { textContent: string | null; getAttribute: (name: string) => string | null } | null;
    };
  }>("../../src/web/markdown-renderer.js");

  const table = parseMarkdownTable(["# 结论", "", "| 项目 | 状态 |", "| --- | --- |", "| 表格 | 已渲染 |", "", "- 保留列表"], 2);
  assert(table, "markdown table syntax should be recognized");
  assert(table?.headers.join(",") === "项目,状态", "markdown table should parse header cells");
  assert(table?.rows[0]?.join(",") === "表格,已渲染", "markdown table should parse body rows");
  assert(table?.endIndex === 4, "markdown table should stop before blank lines or following markdown blocks");

  const compactTable = parseMarkdownTable(["Name | Value", "--- | ---", "A | 1"], 0);
  assert(compactTable?.rows[0]?.[1] === "1", "markdown table should support rows without surrounding pipes");

  const unsafeTable = parseMarkdownTable(["| <img src=x onerror=alert(1)> | 值 |", "| --- | --- |", "| <script>alert(1)</script> | ok |"], 0);
  assert(unsafeTable?.headers[0] === "<img src=x onerror=alert(1)>", "markdown table parser should preserve unsafe HTML as plain cell text");
  assert(unsafeTable?.rows[0]?.[0] === "<script>alert(1)</script>", "markdown table parser should not interpret HTML inside cells");

  assert(!parseMarkdownTable(["| 项目 | 状态 |", "| -- | -- |", "| 表格 | 已渲染 |"], 0), "markdown tables should require GFM-style divider cells with at least three dashes");

  const fragment = renderMarkdownFragment("# 标题\n\n保留 **加粗** 和 `code`\n\n```text\nhello\n```\n\n<script>alert(1)</script>");
  assert(fragment.querySelector("h1")?.textContent === "标题", "markdown renderer should render headings with a mature parser");
  assert(fragment.querySelector("strong")?.textContent === "加粗", "markdown renderer should render strong syntax");
  assert(fragment.querySelector("p code")?.textContent === "code", "markdown renderer should render inline code syntax");
  assert(fragment.querySelector("pre code")?.textContent === "hello\n", "markdown renderer should render fenced code blocks");
  assert(!fragment.querySelector("script"), "markdown renderer should not preserve raw script elements");

  const codeClassFragment = renderMarkdownFragment("```text\nhello\n```\n\n<code class=\"evil language-js\">raw</code>");
  assert(!codeClassFragment.querySelector("pre code")?.getAttribute("class"), "markdown renderer should not expose fenced code language classes");
  assert(!codeClassFragment.querySelector("p code")?.getAttribute("class"), "markdown renderer should strip raw code classes");

  const mermaidFragment = renderMarkdownFragment("```mermaid\ngraph TD\n  A --> B\n```");
  const mermaidDiagram = mermaidFragment.querySelector(".mermaid-diagram") as { dataset: Record<string, string> } | null;
  assert(mermaidDiagram, "markdown renderer should upgrade mermaid fenced code blocks into diagram containers");
  assert(mermaidDiagram?.dataset.mermaidSource === "graph TD\n  A --> B", "mermaid diagram should retain source for controlled rendering and fallback");
  assert(!mermaidFragment.querySelector("pre code.language-mermaid"), "mermaid source should not remain visible as a normal code block");

  const rawMermaidClassFragment = renderMarkdownFragment("<pre><code class=\"language-mermaid\">graph TD; A-->B;</code></pre>");
  assert(!rawMermaidClassFragment.querySelector(".mermaid-diagram"), "raw HTML classes should not trigger mermaid rendering");

  console.log("message-renderer tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
