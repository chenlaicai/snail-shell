import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..", "..");
const distDir = path.join(rootDir, "dist");
const webSourceDir = path.join(rootDir, "src", "web");
const webTargetDir = path.join(distDir, "src", "web");
const scriptSourcePath = path.join(rootDir, ".meta", "scripts", "conversation-history");
const scriptTargetDir = path.join(distDir, ".meta", "scripts");
const scriptTargetPath = path.join(scriptTargetDir, "conversation-history");
const regulationExpandScriptSourcePath = path.join(rootDir, ".meta", "scripts", "regulation-expand");
const regulationExpandScriptTargetPath = path.join(scriptTargetDir, "regulation-expand");
const messageOutScriptSourcePath = path.join(rootDir, ".meta", "scripts", "message-out");
const messageOutScriptTargetPath = path.join(scriptTargetDir, "message-out");
const serviceScriptSourcePath = path.join(rootDir, "bin", "snail-service");
const serviceScriptTargetDir = path.join(distDir, "bin");
const serviceScriptTargetPath = path.join(serviceScriptTargetDir, "snail-service");

fs.mkdirSync(path.dirname(webTargetDir), { recursive: true });
fs.cpSync(webSourceDir, webTargetDir, { recursive: true });

fs.mkdirSync(scriptTargetDir, { recursive: true });
fs.copyFileSync(scriptSourcePath, scriptTargetPath);
fs.copyFileSync(regulationExpandScriptSourcePath, regulationExpandScriptTargetPath);
fs.copyFileSync(messageOutScriptSourcePath, messageOutScriptTargetPath);

fs.mkdirSync(serviceScriptTargetDir, { recursive: true });
fs.copyFileSync(serviceScriptSourcePath, serviceScriptTargetPath);

if (process.platform !== "win32") {
  fs.chmodSync(scriptTargetPath, 0o755);
  fs.chmodSync(regulationExpandScriptTargetPath, 0o755);
  fs.chmodSync(messageOutScriptTargetPath, 0o755);
  fs.chmodSync(serviceScriptTargetPath, 0o755);
}
