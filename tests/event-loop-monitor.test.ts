import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Mock blocked-at 库 */
const mockCleanup = vi.fn();
const mockBlocked = vi.fn().mockReturnValue(mockCleanup);
vi.mock("blocked-at", () => ({ default: mockBlocked }));

/** Mock logger */
const mockWarn = vi.fn();
vi.mock("../src/infra/logger", () => ({
  getLogger: () => ({
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("event-loop-monitor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /** BLOCKED_AT_ENABLED=false 时不启动监控 */
  it("does not start monitor when BLOCKED_AT_ENABLED=false", async () => {
    process.env.BLOCKED_AT_ENABLED = "false";

    const { startEventLoopMonitor } = await import("../src/main");
    startEventLoopMonitor();

    expect(mockBlocked).not.toHaveBeenCalled();
  });

  /** 默认启用监控 */
  it("starts monitor by default", async () => {
    delete process.env.BLOCKED_AT_ENABLED;

    const { startEventLoopMonitor } = await import("../src/main");
    startEventLoopMonitor();

    expect(mockBlocked).toHaveBeenCalled();
  });

  /** 阻塞 >5000ms 时记录日志 */
  it("logs when blocking exceeds 5000ms", async () => {
    delete process.env.BLOCKED_AT_ENABLED;

    const { startEventLoopMonitor } = await import("../src/main");
    startEventLoopMonitor();

    // 获取回调函数并模拟阻塞 6000ms
    const callback = mockBlocked.mock.calls[0][0];
    callback(6000, "Error\n  at Object.<anonymous> (/app/src/main.ts:10:5)");

    expect(mockWarn).toHaveBeenCalled();
  });

  /** 阻塞 <=5000ms 时不记录日志 */
  it("does not log when blocking is <=5000ms", async () => {
    delete process.env.BLOCKED_AT_ENABLED;

    const { startEventLoopMonitor } = await import("../src/main");
    startEventLoopMonitor();

    // 获取回调函数并模拟阻塞 4000ms
    const callback = mockBlocked.mock.calls[0][0];
    callback(4000, "Error\n  at Object.<anonymous> (/app/src/main.ts:10:5)");

    expect(mockWarn).not.toHaveBeenCalled();
  });

  /** 调用栈截断到前 20 帧 */
  it("truncates stack to 20 frames", async () => {
    delete process.env.BLOCKED_AT_ENABLED;

    const { startEventLoopMonitor } = await import("../src/main");
    startEventLoopMonitor();

    // 获取回调函数
    const callback = mockBlocked.mock.calls[0][0];

    // 生成 30 帧的调用栈
    const stackFrames = Array.from({ length: 30 }, (_, i) =>
      `  at function${i} (/app/src/file${i}.ts:${i}:5)`
    ).join("\n");
    const stack = `Error\n${stackFrames}`;

    // 模拟阻塞 6000ms
    callback(6000, stack);

    expect(mockWarn).toHaveBeenCalled();

    // 验证截断：日志中的栈帧数应为 20（包含 Error 行）
    const loggedStack = mockWarn.mock.calls[0][0].stack;
    const lines = loggedStack.split("\n");
    expect(lines.length).toBeLessThanOrEqual(21); // Error + 20 frames
  });
});
