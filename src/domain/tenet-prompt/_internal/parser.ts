import type { PromptDocument, PromptWhen } from "@domain/tenet-prompt/model";

/** 解析 frontmatter + markdown 内容 */
export function parsePromptDocument(raw: string): {
  id: string;
  title: string;
  stability: "static" | "dynamic";
  layer: "platform" | "workspace";
  priority: number;
  when: PromptWhen | null;
  content: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Invalid prompt format: missing frontmatter");
  }

  const [, frontmatter, content] = match;
  const meta = parseYaml(frontmatter);

  if (!meta.id) throw new Error("Prompt frontmatter missing 'id'");
  if (!meta.title) throw new Error("Prompt frontmatter missing 'title'");

  return {
    id: meta.id,
    title: meta.title,
    stability: meta.stability ?? "static",
    layer: meta.layer ?? "platform",
    priority: meta.priority ?? 100,
    when: meta.when ?? null,
    content: content.trim(),
  };
}

/** 简单 YAML 解析（仅支持 key: value 和嵌套对象） */
function parseYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentObj: Record<string, unknown> = result;
  let inArray = false;
  let arrayKey = "";
  let arrayItems: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // 数组结束
    if (inArray && !trimmed.startsWith("-")) {
      currentObj[arrayKey] = arrayItems;
      inArray = false;
      arrayItems = [];
    }

    // 数组项
    if (inArray && trimmed.startsWith("-")) {
      arrayItems.push(trimmed.slice(1).trim().replace(/^["']|["']$/g, ""));
      continue;
    }

    // 嵌套对象开始
    const nestedMatch = trimmed.match(/^(\w+):\s*$/);
    if (nestedMatch) {
      currentKey = nestedMatch[1];
      currentObj = {};
      result[currentKey] = currentObj;
      continue;
    }

    // key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;

      // 数组开始
      if (value === "") {
        inArray = true;
        arrayKey = key;
        arrayItems = [];
        continue;
      }

      // 布尔值
      if (value === "true") { currentObj[key] = true; continue; }
      if (value === "false") { currentObj[key] = false; continue; }

      // 数字
      if (/^\d+$/.test(value)) { currentObj[key] = parseInt(value); continue; }

      // 字符串（去除引号）
      currentObj[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  // 处理末尾的数组
  if (inArray) {
    currentObj[arrayKey] = arrayItems;
  }

  return result;
}
