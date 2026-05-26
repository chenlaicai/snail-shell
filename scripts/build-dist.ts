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
const mermaidChunksSourceDir = path.join(rootDir, "node_modules", "mermaid", "dist", "chunks");
const mermaidChunksTargetDir = path.join(webTargetDir, "vendor", "chunks");
const scriptTargetDir = path.join(distDir, ".meta", "scripts");
const serviceScriptSourcePath = path.join(rootDir, "bin", "snail-service");
const serviceScriptTargetDir = path.join(distDir, "bin");
const serviceScriptTargetPath = path.join(serviceScriptTargetDir, "snail-service");

const skillScripts = [
	"conversation-history",
	"knowledge-library",
	"knowledge-candidate",
	"message-out",
	"record-feature-repo-context",
	"set-task-anchor",
];

fs.mkdirSync(path.dirname(webTargetDir), { recursive: true });
fs.cpSync(webSourceDir, webTargetDir, { recursive: true });
fs.mkdirSync(path.dirname(markedTargetPath), { recursive: true });
fs.copyFileSync(markedSourcePath, markedTargetPath);
fs.copyFileSync(mermaidSourcePath, mermaidTargetPath);
fs.cpSync(mermaidChunksSourceDir, mermaidChunksTargetDir, { recursive: true });

fs.mkdirSync(scriptTargetDir, { recursive: true });
for (const name of skillScripts) {
	const sourcePath = path.join(rootDir, ".meta", "skills", name, "scripts", `${name}.js`);
	const targetPath = path.join(scriptTargetDir, `${name}.js`);
	fs.copyFileSync(sourcePath, targetPath);
	if (process.platform !== "win32") {
		fs.chmodSync(targetPath, 0o755);
	}
}

fs.mkdirSync(serviceScriptTargetDir, { recursive: true });
fs.copyFileSync(serviceScriptSourcePath, serviceScriptTargetPath);
if (process.platform !== "win32") {
	fs.chmodSync(serviceScriptTargetPath, 0o755);
}

// 共享桥接脚本（对 AI 不可见）
const bridgeSource = path.join(rootDir, ".meta", "scripts", "db-bridge.js");
const bridgeTarget = path.join(scriptTargetDir, "db-bridge.js");
fs.copyFileSync(bridgeSource, bridgeTarget);
if (process.platform !== "win32") {
	fs.chmodSync(bridgeTarget, 0o755);
}
