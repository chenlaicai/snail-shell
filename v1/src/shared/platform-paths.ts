import path from "path";

// Resolved relative to this source file (v1/src/shared/) → v1/ root.
// Using __dirname instead of process.cwd() so the path is correct regardless of CWD.
export const PLATFORM_ROOT = path.join(__dirname, "..", "..");
export const PLATFORM_META = path.join(PLATFORM_ROOT, ".meta");
