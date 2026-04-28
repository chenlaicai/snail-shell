import assert from "assert";
import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const serviceScript = fs.readFileSync(path.join(rootDir, "bin", "snail-service"), "utf8");

for (const command of ["start", "stop", "restart", "status"]) {
  assert.equal(
    packageJson.scripts[`service:${command}`],
    `./bin/snail-service ${command}`,
    `service:${command} should route through the public service entrypoint`,
  );
}

assert(!serviceScript.includes("server-control.js start"), "snail-service should not hard-code individual service commands");
assert(serviceScript.includes('exec node "$CONTROL_SCRIPT" "$COMMAND" "$@"'), "snail-service should forward commands to server-control");
assert(serviceScript.includes('"$COMMAND" = "restart"'), "restart should use the same fresh-build path as start");

console.log("service entrypoint tests passed");
