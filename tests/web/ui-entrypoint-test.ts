import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const index = fs.readFileSync(path.resolve(__dirname, "../../src/web/index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../../src/web/app.js"), "utf8");
const shell = fs.readFileSync(path.resolve(__dirname, "../../src/web/ui-shell.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");
const conversationSourceEmptyState = fs.readFileSync(path.resolve(__dirname, "../../src/web/conversation-source-empty-state.js"), "utf8");

assert(index.includes('<link rel="stylesheet" href="./styles.css">'), "index.html must load the dedicated stylesheet");
assert(index.includes('<div id="app-root"></div>'), "index.html must expose a single UI mount point");
assert(index.includes('<script type="module" src="./app.js"></script>'), "index.html must keep app.js as the behavior entrypoint");
assert(!index.includes("<style>"), "index.html must not grow another inline style block");
assert(!index.includes("app-shell"), "static application shell must live outside index.html");
assert(app.includes('import { mountUiShell } from "./ui-shell.js";'), "app.js must import the UI shell before DOM bindings");
assert(app.indexOf("mountUiShell($appRoot)") < app.indexOf('document.getElementById("project-list")'), "UI shell must mount before app.js queries shell nodes");
assert(!shell.includes('id="artifact-title"'), "artifact submission form should not ask users for a redundant title");
assert(!app.includes('document.getElementById("artifact-title")'), "artifact creation should not read a title input");
assert(app.includes('import { renderConversationSourceEmptyState as renderConversationSourceEmptyStateView }'), "app should import the source conversation empty-state view");
assert(app.includes("/conversations/${sourceId}"), "source conversation entrypoints should load conversation details before navigation");
assert(app.includes("loadStageConversations(stage.id, { preferredConversationId: conversation.id })"), "source conversation navigation should select the source inside its owning stage");
assert(conversationSourceEmptyState.includes("当前 conversation 还没有消息"), "empty current-stage conversations should explain why the message pane is blank");
assert(conversationSourceEmptyState.includes("onSelectSourceConversation(conversation.id)"), "source empty-state should expose selectable source conversations");
assert(styles.includes(".conversation-source-empty-state"), "source conversation empty-state should have a visible card style");

console.log("ui-entrypoint tests passed");
