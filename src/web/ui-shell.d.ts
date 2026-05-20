/**
 * Type declarations for ui-shell.js.
 *
 * ui-shell.js is a plain JS module that builds the app shell via DOM API.
 * This .d.ts provides minimal type information so TypeScript consumers
 * (tests, tooling) can import it without TS7016 errors.
 */

/**
 * Create a text node.
 */
export function tx(text: string): Text;

/**
 * Create a DOM element.
 *
 * @param tag - HTML tag name
 * @param attrs - attribute map. Special keys:
 *   className → element.className
 *   style    → element.style.cssText
 *   hidden   → element.hidden (boolean)
 *   disabled → element.disabled (boolean)
 *   aria-*, data-*, type, rows, placeholder → element.setAttribute
 *   Everything else → element.setAttribute
 * @param children - strings become text nodes, nodes are appended, arrays are flattened
 */
export function el(
  tag: string,
  attrs?: Record<string, unknown> | null,
  ...children: Array<string | Node | Array<string | Node> | null | false>
): HTMLElement;

/**
 * Append the complete application shell to `root`.
 */
export function mountUiShell(root: HTMLElement): void;
