type ToolDescriber = (input: Record<string, unknown>) => { summary: string; detail: string };

const TOOL_DESCRIPTORS: Record<string, ToolDescriber> = {
  Read: (input) => fileAction("读取", input),
  Write: (input) => fileAction("写入", input),
  Edit: (input) => fileAction("编辑", input),
  Glob: (input) => ({
    summary: `搜索文件模式 ${asString(input.pattern) || "<unknown>"}`,
    detail: input.pattern ? `按模式 ${input.pattern} 搜索文件` : "搜索文件",
  }),
  Grep: (input) => {
    const p = asString(input.pattern) || asString(input.query);
    return {
      summary: `搜索内容 ${p || "<unknown>"}`,
      detail: p ? `搜索内容模式 ${p}` : "搜索文件内容",
    };
  },
  Bash: (input) => ({
    summary: `执行命令 ${clipForDisplay(asString(input.command) || "<unknown>", 72)}`,
    detail: input.command ? `执行命令: ${input.command}` : "执行 shell 命令",
  }),
};

export function describeToolUse(name: string, input: Record<string, unknown>): { summary: string; detail: string } {
  const describer = TOOL_DESCRIPTORS[name];
  if (describer) return describer(input);
  return {
    summary: `${name} 工具调用`,
    detail: `${name} 输入: ${clipForDisplay(JSON.stringify(input), 180)}`,
  };
}

function fileAction(verb: string, input: Record<string, unknown>): { summary: string; detail: string } {
  const filePath = asString(input.file_path) || asString(input.filePath);
  return {
    summary: `${verb}文件 ${summarizePath(filePath)}`,
    detail: filePath ? `${verb} ${filePath}` : `${verb}文件内容`,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function summarizePath(filePath: string): string {
  if (!filePath) {
    return "<unknown>";
  }

  const normalized = filePath.replace(process.cwd(), ".");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) {
    return normalized;
  }

  return `.../${segments.slice(-3).join("/")}`;
}

function clipForDisplay(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
