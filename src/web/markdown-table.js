export function parseMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;
  const headers = splitMarkdownTableRow(lines[startIndex]);
  const divider = splitMarkdownTableRow(lines[startIndex + 1]);
  if (!headers || !divider || !headers.length || headers.length !== divider.length) return null;
  if (!divider.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) return null;

  const rows = [];
  let endIndex = startIndex + 1;
  for (let index = startIndex + 2; index < lines.length; index += 1) {
    const row = splitMarkdownTableRow(lines[index]);
    if (!row) break;
    rows.push(normalizeMarkdownTableRow(row, headers.length));
    endIndex = index;
  }
  return { headers, rows, endIndex };
}

function splitMarkdownTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;
  const body = trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed;
  const cells = body.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function normalizeMarkdownTableRow(row, width) {
  return Array.from({ length: width }, (_, index) => row[index] || "");
}
