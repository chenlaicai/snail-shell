import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importWebModule<T>(relativePath: string): Promise<T> {
  const modulePath = path.resolve(__dirname, relativePath);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<T>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { parseMarkdownTable } = await importWebModule<{ parseMarkdownTable: (lines: string[], startIndex: number) => { headers: string[]; rows: string[][]; endIndex: number } | null }>("../../src/web/markdown-table.js");

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

  console.log("message-renderer tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
