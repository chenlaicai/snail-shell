export function describeToolUse(name: string, input: Record<string, unknown>): { summary: string; detail: string } {
  const filePath = asString(input.file_path) || asString(input.filePath);
  const command = asString(input.command);
  const pattern = asString(input.pattern);
  const query = asString(input.query);
  const fileAction = describeFileAction(name, filePath);

  if (fileAction) {
    return fileAction;
  }

  if (name === "Glob") {
    return {
      summary: `搜索文件模式 ${pattern || "<unknown>"}`,
      detail: pattern ? `按模式 ${pattern} 搜索文件` : "搜索文件",
    };
  }

  if (name === "Grep") {
    return {
      summary: `搜索内容 ${pattern || query || "<unknown>"}`,
      detail: pattern || query ? `搜索内容模式 ${pattern || query}` : "搜索文件内容",
    };
  }

  if (name === "Bash") {
    return {
      summary: `执行命令 ${clipForDisplay(command || "<unknown>", 72)}`,
      detail: command ? `执行命令: ${command}` : "执行 shell 命令",
    };
  }

  return {
    summary: `${name} 工具调用`,
    detail: `${name} 输入: ${clipForDisplay(JSON.stringify(input), 180)}`,
  };
}

function describeFileAction(name: string, filePath: string): { summary: string; detail: string } | null {
  if (name === "Read") {
    return {
      summary: `读取文件 ${summarizePath(filePath)}`,
      detail: filePath ? `读取 ${filePath}` : "读取文件内容",
    };
  }

  if (name === "Write") {
    return {
      summary: `写入文件 ${summarizePath(filePath)}`,
      detail: filePath ? `写入 ${filePath}` : "写入文件内容",
    };
  }

  if (name === "Edit") {
    return {
      summary: `编辑文件 ${summarizePath(filePath)}`,
      detail: filePath ? `编辑 ${filePath}` : "编辑文件内容",
    };
  }

  return null;
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
