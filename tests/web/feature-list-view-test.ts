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
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");
assert(featureListView.includes('feature-title-row'), "feature titles should own a full row in the directory tree");
assert(featureListView.includes('<div class="node-meta feature-meta-row">'), "feature status and actions should be outside the selection button to avoid invalid nested buttons");
assert(featureListView.includes('feature-row-actions'), "feature actions should live inside the metadata row instead of becoming a separate grid row");
assert(!featureListView.includes('${badge}${archiveButton}</span>\n      </button>'), "feature archive button must not be nested inside the feature select button");
assert(featureListView.includes('renderFeatureGroup(element, { title: "已归档"'), "archived features should remain visible as a dedicated directory group");
assert(styles.includes(".feature-row-actions"), "feature action row styles must keep badges and archive actions inline");
assert(styles.includes(".feature-meta-row") && styles.includes("width: 100%"), "feature metadata row must span the title width so archive actions stay inline on the right");

console.log("feature-list-view tests passed");
}

main().catch((error) => {
  throw error;
});
