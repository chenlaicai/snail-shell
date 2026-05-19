import assert from "assert";
import { checkFeatureDocNumbering } from "../../scripts/check-feature-doc-numbering";

const issues = checkFeatureDocNumbering(process.cwd());

assert.deepStrictEqual(issues, [], `feature doc numbering issues:\n${issues.map((issue) => `${issue.message}\n${issue.files.join("\n")}`).join("\n")}`);

console.log("feature-doc-numbering tests passed");
