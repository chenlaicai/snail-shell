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
const recordRepoContextScriptSourcePath = path.join(rootDir, ".meta", "scripts", "record-feature-repo-context");
const recordRepoContextScriptTargetPath = path.join(scriptTargetDir, "record-feature-repo-context");
const knowledgeCandidateScriptSourcePath = path.join(rootDir, ".meta", "scripts", "knowledge-candidate");
const knowledgeCandidateScriptTargetPath = path.join(scriptTargetDir, "knowledge-candidate");
const serviceScriptSourcePath = path.join(rootDir, "bin", "snail-service");
const serviceScriptTargetDir = path.join(distDir, "bin");
const serviceScriptTargetPath = path.join(serviceScriptTargetDir, "snail-service");

fs.mkdirSync(path.dirname(webTargetDir), { recursive: true });
fs.cpSync(webSourceDir, webTargetDir, { recursive: true });

fs.mkdirSync(scriptTargetDir, { recursive: true });
fs.copyFileSync(scriptSourcePath, scriptTargetPath);
fs.copyFileSync(regulationExpandScriptSourcePath, regulationExpandScriptTargetPath);
fs.copyFileSync(recordRepoContextScriptSourcePath, recordRepoContextScriptTargetPath);
fs.copyFileSync(knowledgeCandidateScriptSourcePath, knowledgeCandidateScriptTargetPath);

fs.mkdirSync(serviceScriptTargetDir, { recursive: true });
fs.copyFileSync(serviceScriptSourcePath, serviceScriptTargetPath);

if (process.platform !== "win32") {
  fs.chmodSync(scriptTargetPath, 0o755);
  fs.chmodSync(regulationExpandScriptTargetPath, 0o755);
  fs.chmodSync(recordRepoContextScriptTargetPath, 0o755);
  fs.chmodSync(knowledgeCandidateScriptTargetPath, 0o755);
  fs.chmodSync(serviceScriptTargetPath, 0o755);
}
