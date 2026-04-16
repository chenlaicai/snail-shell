import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..", "..");
const distDir = path.join(rootDir, "dist");
const webSourceDir = path.join(rootDir, "src", "web");
const webTargetDir = path.join(distDir, "src", "web");
const scriptSourcePath = path.join(rootDir, ".meta", "scripts", "conversation-history");
const scriptTargetDir = path.join(distDir, ".meta", "scripts");
const scriptTargetPath = path.join(scriptTargetDir, "conversation-history");

fs.mkdirSync(path.dirname(webTargetDir), { recursive: true });
fs.cpSync(webSourceDir, webTargetDir, { recursive: true });

fs.mkdirSync(scriptTargetDir, { recursive: true });
fs.copyFileSync(scriptSourcePath, scriptTargetPath);

if (process.platform !== "win32") {
  fs.chmodSync(scriptTargetPath, 0o755);
}
