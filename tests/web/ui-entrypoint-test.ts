import fs from "fs";
import path from "path";
import { getShellHTML } from "./helpers/shell-dom.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const index = fs.readFileSync(path.resolve(__dirname, "../../src/web/index.html"), "utf8");
  const app = fs.readFileSync(path.resolve(__dirname, "../../src/web/app.js"), "utf8");
  const projectConfigView = fs.readFileSync(path.resolve(__dirname, "../../src/web/project-config-view.js"), "utf8");
  const stylesDir = path.resolve(__dirname, "../../src/web/styles");
  const styles = [
    fs.readFileSync(path.join(stylesDir, "tokens.css"), "utf8"),
    fs.readFileSync(path.join(stylesDir, "base.css"), "utf8"),
    fs.readFileSync(path.join(stylesDir, "layout.css"), "utf8"),
    fs.readFileSync(path.join(stylesDir, "utilities.css"), "utf8"),
    ...fs.readdirSync(path.join(stylesDir, "components")).map((f) => fs.readFileSync(path.join(stylesDir, "components", f), "utf8")),
  ].join("\n");
  const conversationSourceEmptyState = fs.readFileSync(path.resolve(__dirname, "../../src/web/conversation-source-empty-state.js"), "utf8");

  assert(index.includes('<link rel="stylesheet" href="./styles.css">'), "index.html must load the dedicated stylesheet");
  assert(index.includes('<div id="app-root"></div>'), "index.html must expose a single UI mount point");
  assert(index.includes('<script type="module" src="./app.js"></script>'), "index.html must keep app.js as the behavior entrypoint");
  assert(!index.includes("<style>"), "index.html must not grow another inline style block");
  assert(!index.includes("app-shell"), "static application shell must live outside index.html");
  assert(app.includes('import { mountUiShell } from "./ui-shell.js";'), "app.js must import the UI shell before DOM bindings");
  assert(app.indexOf("mountUiShell($appRoot)") < app.indexOf('document.getElementById("project-list")'), "UI shell must mount before app.js queries shell nodes");

  // ── 入口模块初始化顺序 ──
  // workspaceContext / snailDenController 必须在 WorkspaceTree 构造前声明，
  // 否则触发 TDZ ReferenceError 导致整个 Web UI 入口模块加载失败。
  assert(
    app.indexOf("const workspaceContext = createWorkspaceContext(") < app.indexOf("const workspaceTree = new WorkspaceTree("),
    "workspaceContext must be declared before WorkspaceTree construction to avoid TDZ",
  );
  assert(
    app.indexOf("const snailDenController = createSnailDenController(") < app.indexOf("const workspaceTree = new WorkspaceTree("),
    "snailDenController must be declared before WorkspaceTree construction to avoid TDZ",
  );

  // ── Shell assertions use the rendered DOM HTML ──
  const shell = await getShellHTML();

  assert(!shell.includes('id="artifact-title"'), "artifact submission form should not ask users for a redundant title");
  assert(!app.includes('document.getElementById("artifact-title")'), "artifact creation should not read a title input");
  assert(app.includes('import { renderConversationSourceEmptyState as renderConversationSourceEmptyStateView }'), "app should import the source conversation empty-state view");
  assert(app.includes("/conversations/${sourceId}"), "source conversation entrypoints should load conversation details before navigation");
  assert(app.includes("loadStageConversations(stage.id, { preferredConversationId: conversation.id })"), "source conversation navigation should select the source inside its owning stage");
  assert(app.includes("const selectionToken = state.conversationSelectionToken + 1"), "source conversation navigation should guard async transitions with selection tokens");
  assert(conversationSourceEmptyState.includes("当前 conversation 还没有消息"), "empty current-stage conversations should explain why the message pane is blank");
  assert(conversationSourceEmptyState.includes("onSelectSourceConversation(conversation.id)"), "source empty-state should expose selectable source conversations");
  assert(styles.includes(".conversation-source-empty-state"), "source conversation empty-state should have a visible card style");
  assert(shell.includes('id="project-config-panel"'), "project workspace must provide a real project configuration panel mount");
  assert(shell.includes('id="project-config-page"'), "project configuration panel must expose a dedicated page mount");
  assert(app.includes('document.getElementById("new-project-btn").addEventListener("click", startProjectConfig)'), "new project entry must open the configuration page instead of browser prompts");
  assert(!app.includes('prompt("项目名称")'), "project creation must not use a prompt dialog for the name");
  assert(!app.includes('prompt("项目摘要'), "project creation must not use a prompt dialog for the summary");
  assert(app.includes('import { createProjectConfigController } from "./project-config-view.js";'), "app should delegate the long project configuration form to a dedicated module");
  assert(app.includes('api("GET", "/roles")'), "role definitions must be loaded from the final /roles endpoint");
  assert(!app.includes('api("GET", "/snails")'), "the web app must not call the removed /snails compatibility endpoint");
  assert(app.includes("getTemplates: () => snailDenController.getTemplates()"), "project configuration must use real Snail Den templates instead of role definitions");
  assert(app.includes("if (!snailDenController.getTemplates().length)"), "project creation availability must be guarded by Snail Den templates");
  assert(app.includes("function cancelProjectConfig()"), "project configuration cancellation must have an explicit exit path");
  assert(app.includes('switchPrimaryView("projects");'), "project configuration cancellation must restore the project workspace primary view");
  assert(app.includes("onCancel() {\n    cancelProjectConfig();\n  }"), "project configuration cancel action must leave the independent config view instead of only clearing its content");
  assert(projectConfigView.includes("stage_definitions"), "project creation must submit stage definitions from the configuration page");
  assert(projectConfigView.includes("snail_template_id"), "project configuration must expose role to snail template binding");
  assert(styles.includes(".project-config-page"), "project configuration page must have dedicated layout styling");
  assert(styles.includes(".project-config-panel"), "project configuration panel must have independent primary view styling");

  console.log("ui-entrypoint tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
