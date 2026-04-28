import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const rootDir = path.resolve(__dirname, "..", "..");
const testsDir = path.join(rootDir, "dist", "tests");

function collectTestFiles(currentDir: string, files: string[]): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      collectTestFiles(fullPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith("-test.js")) {
      files.push(fullPath);
    }
  }
}

if (!fs.existsSync(testsDir)) {
  console.log(`Compiled tests directory does not exist, skipping test execution: ${testsDir}`);
  process.exit(0);
}

const testFiles: string[] = [];
collectTestFiles(testsDir, testFiles);

testFiles.sort((left, right) => {
  const leftRelative = path.relative(rootDir, left).split(path.sep).join("/");
  const rightRelative = path.relative(rootDir, right).split(path.sep).join("/");
  return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
});

if (testFiles.length === 0) {
  console.log(`No compiled test files were found under ${testsDir}; skipping test execution.`);
  process.exit(0);
}

console.log(`Running ${testFiles.length} compiled test files:`);
for (const file of testFiles) {
  console.log(`- ${path.relative(rootDir, file).split(path.sep).join("/")}`);
}

for (const file of testFiles) {
  const relativePath = path.relative(rootDir, file).split(path.sep).join("/");
  console.log(`\n>>> ${relativePath}`);
  const result = spawnSync(process.execPath, [file], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${testFiles.length} compiled test files passed.`);
