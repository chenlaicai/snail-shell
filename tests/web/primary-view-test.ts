import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeClassList {
  private readonly values = new Set<string>();

  toggle(name: string, force?: boolean): void {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  hidden = false;
  private readonly attributes = new Map<string, string>();

  constructor(private readonly viewRelated: string | null = null) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    if (name === "data-view-related") return this.viewRelated;
    return this.attributes.get(name) ?? null;
  }
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/primary-view.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ applyPrimaryView: (view: string, elements: any) => string }>;
  const { applyPrimaryView } = await dynamicImport(moduleUrl);
  const projectOnly = new FakeElement("projects");
  const knowledgeOnly = new FakeElement("knowledge");
  const elements = {
    appShell: new FakeElement(),
    navProjects: new FakeElement(),
    navKnowledge: new FakeElement(),
    workspaceMain: new FakeElement(),
    knowledgePanel: new FakeElement(),
    viewRelated: [projectOnly, knowledgeOnly],
  };

  assert(applyPrimaryView("knowledge", elements) === "knowledge", "knowledge should be a valid primary view");
  assert(elements.appShell.dataset.primaryView === "knowledge", "app shell should expose the active primary view");
  assert(elements.navKnowledge.classList.contains("active"), "knowledge nav should be active");
  assert(elements.navKnowledge.getAttribute("aria-current") === "page", "active nav should be accessible as the current page");
  assert(elements.knowledgePanel.classList.contains("is-active") && !elements.knowledgePanel.hidden, "knowledge panel should be visible");
  assert(elements.workspaceMain.hidden, "project workspace should be hidden in knowledge view");
  assert(projectOnly.hidden && !knowledgeOnly.hidden, "project-only related panels should not leak into knowledge view");

  assert(applyPrimaryView("unknown", elements) === "projects", "unknown primary views should fall back to projects");
  assert(elements.appShell.dataset.primaryView === "projects", "fallback view should update the app shell");
  assert(elements.navProjects.classList.contains("active"), "project nav should be active after fallback");
  assert(elements.workspaceMain.classList.contains("is-active") && !elements.workspaceMain.hidden, "project workspace should be visible after fallback");
  assert(!projectOnly.hidden && knowledgeOnly.hidden, "knowledge-only related panels should be hidden in projects view");

  console.log("primary-view tests passed");
}

main().catch((error) => {
  throw error;
});
