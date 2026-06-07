/**
 * JSONC 解析工具：移除注释和尾随逗号，输出合法 JSON 字符串。
 * guard-config.ts 和 mcp-config.ts 共用此实现。
 */

/** 从 pos 处的 `"` 开始扫描到闭合引号，处理 `\\` 转义，返回 token 和结束位置。 */
function scanJsoncString(jsonc: string, pos: number): { token: string; end: number } {
  const chars = ['"'];
  let i = pos + 1;
  while (i < jsonc.length) {
    const c = jsonc[i];
    chars.push(c);
    if (c === "\\") {
      i++;
      if (i < jsonc.length) chars.push(jsonc[i]);
    } else if (c === '"') {
      break;
    }
    i++;
  }
  return { token: chars.join(""), end: i + 1 };
}

/** 尝试跳过 pos 处的 JSONC 注释（// 或 /* * /），返回新位置；非注释返回 -1。 */
function skipJsoncComment(jsonc: string, pos: number): number {
  if (jsonc[pos] !== "/" || pos + 1 >= jsonc.length) return -1;
  const next = jsonc[pos + 1];
  if (next === "/") {
    const lineEnd = jsonc.indexOf("\n", pos);
    return lineEnd === -1 ? jsonc.length : lineEnd;
  }
  if (next === "*") {
    const commentEnd = jsonc.indexOf("*/", pos + 2);
    return commentEnd === -1 ? jsonc.length : commentEnd + 2;
  }
  return -1;
}

/** 移除 JSONC 注释和尾随逗号，返回合法 JSON 字符串。 */
export function parseJsonc(jsonc: string): string {
  const tokens: string[] = [];
  let pos = 0;

  while (pos < jsonc.length) {
    const ch = jsonc[pos];

    if (ch === '"') {
      const { token, end } = scanJsoncString(jsonc, pos);
      tokens.push(token);
      pos = end;
      continue;
    }

    const afterComment = skipJsoncComment(jsonc, pos);
    if (afterComment >= 0) { pos = afterComment; continue; }

    tokens.push(ch);
    pos++;
  }

  return tokens.join("").replace(/,(\s*[}\]])/g, "$1");
}
