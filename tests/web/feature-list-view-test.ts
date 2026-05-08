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
assert(featureListView.includes('feature-title-row'), "feature titles should own a full row in the directory tree");
assert(featureListView.includes('feature-meta-row'), "feature status and stage metadata should be demoted below the title");
assert(featureListView.includes('renderFeatureGroup(element, { title: "已归档"'), "archived features should remain visible as a dedicated directory group");

console.log("feature-list-view tests passed");
}

main().catch((error) => {
  throw error;
});
