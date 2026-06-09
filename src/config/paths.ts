/**
 * 平台路径常量
 *
 * 在模块加载时捕获平台根目录路径。
 */

import path from "path";

// Captured at module load time (process startup). process.cwd() at startup = platform repo root.
// Child processes spawned for agents don't change the parent's cwd.
export const PLATFORM_ROOT = process.cwd();
export const PLATFORM_META = path.join(PLATFORM_ROOT, ".meta");
