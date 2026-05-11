import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importWebModule<T>(relativePath: string): Promise<T> {
  const modulePath = path.resolve(__dirname, relativePath);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<T>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { buildFeatureGroups } = await importWebModule<{ buildFeatureGroups: (features: any[]) => { activeFeatures: any[]; archivedFeatures: any[] } }>("../../src/web/feature-list-view.js");
  const features = [
    { id: "new-active", status: "active" },
    { id: "new-archived", status: "archived" },
    { id: "old-review", status: "in_review" },
    { id: "old-archived", status: "archived" },
  ];

const groups = buildFeatureGroups(features);
assert(groups.activeFeatures.map((feature) => feature.id).join(",") === "new-active,old-review", "non-archived features should keep backend time order above archive group");
assert(groups.archivedFeatures.map((feature) => feature.id).join(",") === "new-archived,old-archived", "archived features should keep backend time order inside the archive group");

const featureListView = fs.readFileSync(path.resolve(__dirname, "../../src/web/feature-list-view.js"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../../src/web/app.js"), "utf8");
const projectTreeView = fs.readFileSync(path.resolve(__dirname, "../../src/web/project-tree-view.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");
assert(featureListView.includes('feature-title-row'), "feature titles should own a full row in the directory tree");
assert(featureListView.includes('feature-title-text'), "feature titles should use a dedicated two-line text clamp");
assert(!featureListView.includes('stageLabel'), "feature rows should not spend left-directory width on stage labels");
assert(!featureListView.includes('escapeHtml(feature.status)'), "feature rows should not spend left-directory width on active status text");
assert(featureListView.includes('feature-row-actions'), "feature actions should live on the right side of the feature title row");
assert(!featureListView.includes('${badge}${archiveButton}</span>\n      </button>'), "feature archive button must not be nested inside the feature select button");
assert(featureListView.includes('feature-conversation-branch'), "current feature conversations should render as a child branch under that feature");
assert(featureListView.includes('renderConversationList(list'), "feature list should render conversations inside the current feature branch");
assert(featureListView.includes('renderFeatureGroup(element, { title: "已归档"'), "archived features should remain visible as a dedicated directory group");
assert(app.includes('async function loadStageConversations'), "feature selection should load conversations for the current stage");
assert(app.includes('`/stages/${stageId}/conversations`'), "current feature branch should stay scoped to the current stage conversation list");
assert(!app.includes('async function loadFeatureConversations'), "conversation branch must not mix conversations from all stages");
assert(!app.includes('`/features/${state.currentFeature.id}/conversations`'), "conversation branch must not use feature-level history as the active work list");
assert(projectTreeView.includes('当前阶段还没有对话'), "empty state should describe the current-stage conversation branch");
assert(styles.includes(".feature-row-actions"), "feature action row styles must keep badges and archive actions inline");
assert(styles.includes("-webkit-line-clamp: 2"), "feature title text should clamp to two readable lines");
assert(styles.includes(".feature-conversation-branch"), "feature conversation branch styles must preserve the Project > Feature > Conversation hierarchy");

console.log("feature-list-view tests passed");
}

main().catch((error) => {
  throw error;
});
