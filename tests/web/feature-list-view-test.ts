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
    { id: "new-active", closed_at: null },
    { id: "new-archived", closed_at: "2024-01-01" },
    { id: "old-review", closed_at: null },
    { id: "old-archived", closed_at: "2023-06-15" },
  ];

  const groups = buildFeatureGroups(features);
  assert(groups.activeFeatures.map((feature) => feature.id).join(",") === "new-active,old-review", "non-archived features should keep backend time order above archive group");
  assert(groups.archivedFeatures.map((feature) => feature.id).join(",") === "new-archived,old-archived", "archived features should keep backend time order inside the archive group");

  console.log("feature-list-view tests passed");
}

main().catch((error) => {
  throw error;
});
