#!/usr/bin/env tsx

import fs from "fs";
import path from "path";

function generateTypes(): void {
  const outputPath = path.join(process.cwd(), "src", "meta", "generated-types.ts");

  const content = `// This file is auto-generated.
// Do not edit manually. Run 'npm run generate-types' to regenerate.

/** 参与者标识（角色名或 "Boss Snail"）。 */
export type SnailName = string;

/** Stage 类型标识，由 project_stage_definition.key 驱动。 */
export type StageType = string;
`;

  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`✓ Generated types at ${outputPath}`);
}

try {
  generateTypes();
} catch (error) {
  console.error("Failed to generate types:", error);
  process.exit(1);
}
