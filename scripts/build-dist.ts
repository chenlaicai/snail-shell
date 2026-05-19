import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..", "..");
const distDir = path.join(rootDir, "dist");
const webSourceDir = path.join(rootDir, "src", "web");
const webTargetDir = path.join(distDir, "src", "web");
const markedSourcePath = path.join(rootDir, "node_modules", "marked", "lib", "marked.esm.js");
const markedTargetPath = path.join(webTargetDir, "vendor", "marked.esm.js");
const mermaidSourcePath = path.join(rootDir, "node_modules", "mermaid", "dist", "mermaid.esm.min.mjs");
const mermaidTargetPath = path.join(webTargetDir, "vendor", "mermaid.esm.min.mjs");
const scriptTargetDir = path.join(distDir, ".meta", "scripts");
const recordRepoContextScriptSourcePath = path.join(rootDir, ".meta", "skills", "record-feature-repo-context", "record-feature-repo-context");
const recordRepoContextScriptTargetPath = path.join(scriptTargetDir, "record-feature-repo-context");
const conversationHistoryScriptSourcePath = path.join(rootDir, ".meta", "skills", "conversation-history", "conversation-history");
const conversationHistoryScriptTargetPath = path.join(scriptTargetDir, "conversation-history");
const knowledgeCandidateScriptSourcePath = path.join(rootDir, ".meta", "skills", "knowledge-candidate", "knowledge-candidate");
const knowledgeCandidateScriptTargetPath = path.join(scriptTargetDir, "knowledge-candidate");
const serviceScriptSourcePath = path.join(rootDir, "bin", "snail-service");
const serviceScriptTargetDir = path.join(distDir, "bin");
const serviceScriptTargetPath = path.join(serviceScriptTargetDir, "snail-service");

fs.mkdirSync(path.dirname(webTargetDir), { recursive: true });
fs.cpSync(webSourceDir, webTargetDir, { recursive: true });
fs.mkdirSync(path.dirname(markedTargetPath), { recursive: true });
fs.copyFileSync(markedSourcePath, markedTargetPath);
fs.copyFileSync(mermaidSourcePath, mermaidTargetPath);

fs.mkdirSync(scriptTargetDir, { recursive: true });
fs.copyFileSync(recordRepoContextScriptSourcePath, recordRepoContextScriptTargetPath);
fs.copyFileSync(conversationHistoryScriptSourcePath, conversationHistoryScriptTargetPath);
fs.copyFileSync(knowledgeCandidateScriptSourcePath, knowledgeCandidateScriptTargetPath);

fs.mkdirSync(serviceScriptTargetDir, { recursive: true });
fs.copyFileSync(serviceScriptSourcePath, serviceScriptTargetPath);

if (process.platform !== "win32") {
  fs.chmodSync(conversationHistoryScriptTargetPath, 0o755);
  fs.chmodSync(recordRepoContextScriptTargetPath, 0o755);
  fs.chmodSync(knowledgeCandidateScriptTargetPath, 0o755);
  fs.chmodSync(serviceScriptTargetPath, 0o755);
}
