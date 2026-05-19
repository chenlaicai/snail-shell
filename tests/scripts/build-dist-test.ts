import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const rootDir = path.resolve(__dirname, "..", "..");
const vendorDir = path.join(rootDir, "src", "web", "vendor");
const mermaidModulePath = path.join(vendorDir, "mermaid.esm.min.mjs");
const mermaidChunksDir = path.join(vendorDir, "chunks");

assert(fs.existsSync(mermaidModulePath), "build should copy mermaid ESM entry into the web vendor directory");
assert(fs.statSync(mermaidChunksDir).isDirectory(), "build should copy mermaid ESM chunks next to the entry module");

const mermaidModule = fs.readFileSync(mermaidModulePath, "utf8");
const chunkImports = Array.from(mermaidModule.matchAll(/import(?:\([^)]*|[^"']*)["'](\.\/chunks\/[^"']+)["']/g), (match) => match[1]);
assert(chunkImports.length > 0, "mermaid ESM entry should declare browser chunk imports");

for (const chunkImport of chunkImports) {
  const chunkPath = path.join(vendorDir, chunkImport);
  assert(fs.existsSync(chunkPath), `build should include mermaid chunk dependency: ${chunkImport}`);
}

console.log("build-dist tests passed");
