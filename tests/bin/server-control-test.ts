import fs from "fs";
import path from "path";
import os from "os";
import { flushLogTail } from "../../src/bin/server-control";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-control-test-"));
const logPath = path.join(tmpDir, "test.log");

const originalStdoutWrite = process.stdout.write;
const capturedOutput: string[] = [];
process.stdout.write = ((chunk: any) => {
  capturedOutput.push(typeof chunk === "string" ? chunk : chunk.toString());
  return true;
}) as typeof process.stdout.write;

try {
  // 1. 空文件：无输出
  fs.writeFileSync(logPath, "");
  const pos1 = { value: 0 };
  flushLogTail(logPath, pos1);
  assert(pos1.value === 0, "空文件 lastPos 应保持 0");
  assert(capturedOutput.length === 0, "空文件不应写 stdout");

  // 2. 新内容：应 flush 到 stdout
  fs.appendFileSync(logPath, "[time] [INFO] line one\n");
  flushLogTail(logPath, pos1);
  assert(pos1.value > 0, "有新内容时 lastPos 应更新");
  assert(capturedOutput.length === 1, "有新内容时应写 stdout");
  assert(capturedOutput[0].includes("line one"), "stdout 应包含新内容");

  // 3. 无增量：不重复输出
  const prevLen = capturedOutput.length;
  flushLogTail(logPath, pos1);
  assert(capturedOutput.length === prevLen, "无增量时不应追加 stdout");

  // 4. 增量追加：只输出新增行
  fs.appendFileSync(logPath, "[time] [INFO] line two\n");
  flushLogTail(logPath, pos1);
  assert(capturedOutput.length === prevLen + 1, "增量时应只追加一次 stdout");
  assert(capturedOutput[capturedOutput.length - 1].includes("line two"), "stdout 应包含新行");
  assert(!capturedOutput[capturedOutput.length - 1].includes("line one"), "stdout 不应重复旧内容");

  // 5. 文件不存在：不抛错，lastPos 不进位
  const pos2 = { value: 0 };
  const beforeLen = capturedOutput.length;
  flushLogTail(path.join(tmpDir, "nonexistent.log"), pos2);
  assert(pos2.value === 0, "文件不存在时 lastPos 应保持 0");
  assert(capturedOutput.length === beforeLen, "文件不存在时不应写 stdout");

  console.log("server-control tests passed");
} finally {
  process.stdout.write = originalStdoutWrite;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
