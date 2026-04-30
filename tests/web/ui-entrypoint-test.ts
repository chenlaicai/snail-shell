import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const index = fs.readFileSync(path.resolve(__dirname, "../../src/web/index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../../src/web/app.js"), "utf8");

assert(index.includes('<link rel="stylesheet" href="./styles.css">'), "index.html must load the dedicated stylesheet");
assert(index.includes('<div id="app-root"></div>'), "index.html must expose a single UI mount point");
assert(index.includes('<script type="module" src="./app.js"></script>'), "index.html must keep app.js as the behavior entrypoint");
assert(!index.includes("<style>"), "index.html must not grow another inline style block");
assert(!index.includes("app-shell"), "static application shell must live outside index.html");
assert(app.includes('import { mountUiShell } from "./ui-shell.js";'), "app.js must import the UI shell before DOM bindings");
assert(app.indexOf("mountUiShell($appRoot)") < app.indexOf('document.getElementById("project-list")'), "UI shell must mount before app.js queries shell nodes");

console.log("ui-entrypoint tests passed");
