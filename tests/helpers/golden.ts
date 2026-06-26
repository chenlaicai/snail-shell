import { expect } from "vitest";
import fs from "fs";
import path from "path";

const GOLDEN_DIR = path.resolve(__dirname, "..", "golden");
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";

/**
 * 将实际输出与 golden file 快照对比。
 *
 * - UPDATE_GOLDEN=1 时自动更新快照文件
 * - golden file 不存在时自动创建（需 UPDATE_GOLDEN=1）
 * - 格式：JSON（diff-friendly）
 */
export function expectGolden(actual: unknown, goldenPath: string): void {
  const fullPath = path.join(GOLDEN_DIR, goldenPath);
  const normalized = JSON.stringify(actual, null, 2) + "\n";

  if (UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, normalized, "utf-8");
    return;
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Golden file not found: ${goldenPath}\n` +
      `Run with UPDATE_GOLDEN=1 to create the initial snapshot.`
    );
  }

  const expected = fs.readFileSync(fullPath, "utf-8");
  expect(normalized).toBe(expected);
}
