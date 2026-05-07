import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeElement {
  innerHTML = "";

  querySelector(): null {
    return null;
  }

  querySelectorAll(): unknown[] {
    return [];
  }
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/knowledge-center.js");
  const messageViewPath = path.resolve(__dirname, "../../src/web/message-view.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8").replace('import { escapeHtml } from "./message-view.js";', "");
  const messageViewSource = fs.readFileSync(messageViewPath, "utf8");
  const escapeHtmlMatch = messageViewSource.match(/export function escapeHtml\(value\)[\s\S]*?\n}/);
  if (!escapeHtmlMatch) throw new Error("escapeHtml export should be discoverable");
  const testSource = `${escapeHtmlMatch[0].replace("export function", "function")}\n${moduleSource}`;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(testSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ createKnowledgeCenter: (input: any) => any }>;
  const { createKnowledgeCenter } = await dynamicImport(moduleUrl);

  const elements = { summary: new FakeElement(), list: new FakeElement(), detail: new FakeElement() };
  const knowledgeCenter = createKnowledgeCenter({
    api: async () => [],
    elements,
    getCurrentProject: () => null,
    showNotice: () => undefined,
  });

  knowledgeCenter.state.items = [{
    id: "knowledge-1",
    title: "知识生效路径",
    content: "知识可以通过 skill、tool 和 checker 静态生效。",
    kind: "decision",
    status: "active",
    governance_level: "L2",
    scope_type: "project",
    scope_ref: "project-1",
    snippet: "知识可以通过 skill、tool 和 checker 静态生效。",
  }];
  knowledgeCenter.state.selected = {
    ...knowledgeCenter.state.items[0],
    sources: [],
    usage_policy: {
      allow_prompt_injection: false,
      prompt_mode: "reference_only",
      skill_visibility: ["knowledge-activation"],
      tool_visibility: ["mcp:knowledge"],
      checker_binding: "knowledge-activation-policy-test",
      stage_types: ["development"],
      snail_names: ["Implementation Snail"],
      priority: 30,
    },
    use_count: 2,
  };

  knowledgeCenter.render();

  assert(elements.summary.innerHTML.includes("prompt、skill、tool、checker"), "summary should describe multiple activation routes");
  assert(elements.detail.innerHTML.includes("skill: knowledge-activation"), "detail should show skill activation policy");
  assert(elements.detail.innerHTML.includes("tool: mcp:knowledge"), "detail should show tool activation policy");
  assert(elements.detail.innerHTML.includes("checker: knowledge-activation-policy-test"), "detail should show checker binding");
  assert(elements.detail.innerHTML.includes("stage: development"), "detail should show stage constraints");
  assert(elements.detail.innerHTML.includes("snail: Implementation Snail"), "detail should show snail constraints");

  console.log("knowledge-center tests passed");
}

main().catch((error) => {
  throw error;
});
