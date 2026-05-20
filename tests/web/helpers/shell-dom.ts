/**
 * shell-dom.ts — Minimal DOM mock for rendering ui-shell.js to an HTML string.
 *
 * `ui-shell.js` builds the app shell via `document.createElement` /
 * `document.createTextNode`.  This helper replaces the global `document`
 * with a recorder so the exported `mountUiShell()` can be called in Node
 * without a real browser, producing a HTML string that tests can inspect.
 */

// ── Types ──

interface StyleProxy {
  cssText: string;
}

interface MockNode {
  tag?: string;
  text?: string;
  attrs: Record<string, string>;
  className: string;
  /** Exposed as `node.style` so `el()` can write `node.style.cssText = value`. */
  style: StyleProxy;
  hidden: boolean;
  disabled: boolean;
  children: MockNode[];
  appendChild(child: MockNode): void;
  setAttribute(name: string, value: string): void;
}

// ── Mock helpers ──

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const voidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function serialize(node: MockNode): string {
  if (node.text !== undefined) return escapeHtml(node.text);

  const tag = node.tag || "div";
  let html = `<${tag}`;

  if (node.className) html += ` class="${node.className}"`;
  if (node.style.cssText) html += ` style="${node.style.cssText}"`;
  if (node.hidden) html += " hidden";
  if (node.disabled) html += " disabled";

  // Attributes set via setAttribute() — emit in stable key order
  const sortedKeys = Object.keys(node.attrs).sort();
  for (const key of sortedKeys) {
    html += ` ${key}="${node.attrs[key]}"`;
  }

  if (voidElements.has(tag)) {
    html += ">";
    return html;
  }

  html += ">";
  for (const child of node.children) {
    html += serialize(child);
  }
  html += `</${tag}>`;
  return html;
}

/**
 * Create a mock DOM element that `el()` can write to.
 *
 * Matches the exact access patterns in ui-shell.js `el()`:
 * - `node.className = value`
 * - `node.style.cssText = value`
 * - `node.setAttribute(key, value)`
 * - `node.hidden = bool` / `node.disabled = bool`
 * - `node.appendChild(child)`
 * - `node.removeChild(child)` / `node.insertBefore(child, ref)` (no-ops)
 */
function createElement(tag: string): MockNode {
  const styleObj: StyleProxy = { cssText: "" };
  const node: MockNode = {
    tag,
    text: undefined,
    attrs: {},
    className: "",
    style: styleObj,
    hidden: false,
    disabled: false,
    children: [],

    appendChild(child: MockNode) {
      node.children.push(child);
    },

    setAttribute(name: string, value: string) {
      // `el()` routes only non-special keys through setAttribute
      if (name === "class") {
        node.className = value;
      } else if (name === "style") {
        node.style.cssText = value;
      } else {
        node.attrs[name] = value;
      }
    },
  };
  return node;
}

/**
 * Create a text node mock.
 */
function createTextNode(text: string): MockNode {
  return {
    tag: undefined,
    text,
    attrs: {},
    className: "",
    style: { cssText: "" },
    hidden: false,
    disabled: false,
    children: [],
    appendChild() {},
    setAttribute() {},
  };
}

function createMockDocument() {
  return { createElement, createTextNode };
}

// ── Public API ──

let _cachedHTML: string | null = null;

/**
 * Render `mountUiShell()` to an HTML string.
 *
 * Mocks the global `document`, imports the shell module, mounts the shell
 * against a temporary root, and serializes the resulting DOM tree.
 *
 * Results are cached so multiple test assertions don't re-import.
 */
export async function getShellHTML(): Promise<string> {
  if (_cachedHTML !== null) return _cachedHTML;

  const mockDoc = createMockDocument();

  // Replace global document
  const origDoc = (globalThis as any).document;
  (globalThis as any).document = mockDoc;

  try {
    // Dynamic import — tsx supports this for .js ES modules.
    // `ui-shell.js` now has a .d.ts, but we cast the module to `any`
    // because the mock DOM replaces the real `document` at runtime, so
    // the actual DOM types don't match our MockNode proxies.
    const mod: any = await import("../../../src/web/ui-shell.js");
    // Use the mock's createElement so root has appendChild etc.
    const root = createElement("div");
    mod.mountUiShell(root as any);
    _cachedHTML = root.children.map((c) => serialize(c)).join("\n");
    return _cachedHTML!;
  } finally {
    (globalThis as any).document = origDoc;
  }
}

/**
 * Discard the cached HTML (useful between test files).
 */
export function clearShellCache(): void {
  _cachedHTML = null;
}
