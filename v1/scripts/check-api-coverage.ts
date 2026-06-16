#!/usr/bin/env npx tsx
/**
 * check-api-coverage.ts — 检查前端 API 调用覆盖率
 *
 * 扫描 src/web/ 中所有 api("METHOD /api/path") 调用，
 * 与 src/api-contracts/endpoints.ts 中的 ApiEndpoints key 列表对比，
 * 输出已覆盖 / 未覆盖的 endpoint 清单。
 *
 * 用法：npx tsx scripts/check-api-coverage.ts
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

// 1. 从 endpoints.ts 提取所有 endpoint key
function extractEndpointKeys(): Set<string> {
  const content = readFileSync("src/api-contracts/endpoints.ts", "utf-8");
  const keys = new Set<string>();
  const regex = /"([A-Z]+ \/api\/[^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

// 2. 递归扫描目录中的 .ts/.tsx 文件
function scanFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "tests") continue;
      files.push(...scanFiles(full));
    } else if (extname(entry) === ".ts" || extname(entry) === ".tsx") {
      files.push(full);
    }
  }
  return files;
}

// 3. 从源文件中提取 api() 调用的 endpoint
function extractApiCalls(files: string[]): Set<string> {
  const calls = new Set<string>();
  const regex = /api\(\s*"([A-Z]+ \/api\/[^"]+)"/g;
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    let match;
    while ((match = regex.exec(content)) !== null) {
      calls.add(match[1]);
    }
  }
  return calls;
}

// 4. 对比并输出
const endpointKeys = extractEndpointKeys();
const apiCalls = extractApiCalls(scanFiles("src/web"));

const covered = [...endpointKeys].filter((k) => apiCalls.has(k));
const uncovered = [...endpointKeys].filter((k) => !apiCalls.has(k));
const extra = [...apiCalls].filter((k) => !endpointKeys.has(k));

console.log(`\n📊 API 覆盖率报告\n`);
console.log(`总 endpoint 数: ${endpointKeys.size}`);
console.log(`前端已覆盖:     ${covered.length} (${Math.round((covered.length / endpointKeys.size) * 100)}%)`);
console.log(`前端未覆盖:     ${uncovered.length}`);
if (extra.length > 0) console.log(`前端调用但不在契约中: ${extra.length}`);

if (uncovered.length > 0) {
  console.log(`\n❌ 未覆盖的 endpoint:`);
  for (const key of uncovered.sort()) {
    console.log(`  - ${key}`);
  }
}

if (extra.length > 0) {
  console.log(`\n⚠️  前端调用但不在 ApiEndpoints 中（可能需要补充契约）:`);
  for (const key of extra.sort()) {
    console.log(`  - ${key}`);
  }
}

if (uncovered.length === 0 && extra.length === 0) {
  console.log(`\n✅ 100% 覆盖！`);
}

process.exit(uncovered.length > 0 ? 1 : 0);
