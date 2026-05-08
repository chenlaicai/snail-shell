export function parseMarkdownInlineSegments(text) {
  const segments = [];
  let plain = "";
  let index = 0;
  const source = String(text || "");

  while (index < source.length) {
    if (source[index] === "`") {
      const endIndex = source.indexOf("`", index + 1);
      if (endIndex > index + 1) {
        pushPlainSegment(segments, plain);
        plain = "";
        segments.push({ type: "code", text: source.slice(index + 1, endIndex) });
        index = endIndex + 1;
        continue;
      }
    }

    if (source.startsWith("**", index)) {
      const endIndex = source.indexOf("**", index + 2);
      if (endIndex > index + 2) {
        pushPlainSegment(segments, plain);
        plain = "";
        segments.push({ type: "strong", text: source.slice(index + 2, endIndex) });
        index = endIndex + 2;
        continue;
      }
    }

    plain += source[index];
    index += 1;
  }

  pushPlainSegment(segments, plain);
  return segments;
}

function pushPlainSegment(segments, text) {
  if (text) segments.push({ type: "text", text });
}

export function appendMarkdownInlineChildren(node, text) {
  parseMarkdownInlineSegments(text).forEach((segment) => {
    const child = document.createElement(segment.type === "strong" ? "strong" : (segment.type === "code" ? "code" : "span"));
    child.textContent = segment.text;
    node.appendChild(child);
  });
}
