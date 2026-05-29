import { MessageInterruptRegistry } from "../../src/message-bus/message-interrupt";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

testBasicInterruptScoping();
testRegisterStopPromiseWaitsForResolution();
testRegisterStopPromiseMultipleAgents();
testFinishMessageCleansUpStopPromise();

console.log("message-interrupt tests passed");

function testBasicInterruptScoping(): void {
  const registry = new MessageInterruptRegistry();
  const projectController = registry.createRunController();
  const governanceController = registry.createRunController();

  registry.bindMessage("project-conversation", 1, projectController);
  registry.bindMessage("knowledge-governance-conversation", 1, governanceController);

  assert(registry.interrupt("knowledge-governance-conversation", 1) === true, "governance message should be interruptible by its scoped key");
  assert(governanceController.signal.aborted, "governance controller should be aborted");
  assert(!projectController.signal.aborted, "project controller with the same local message id must not be aborted");
  assert(registry.interrupt("knowledge-governance-conversation", 1) === false, "already aborted message should not report a second interrupt");

  registry.finishMessage("project-conversation", 1);
  assert(registry.interrupt("project-conversation", 1) === false, "finished message should no longer be interruptible");
}

/** deferred 模式：registerStopPromise 在 agent 启动前注册，waitForAllStopped 等待 resolve */
async function testRegisterStopPromiseWaitsForResolution(): Promise<void> {
  const registry = new MessageInterruptRegistry();
  let resolved = false;

  const stopPromise = new Promise<void>((resolve) => {
    setTimeout(() => { resolved = true; resolve(); }, 50);
  });

  registry.registerStopPromise("conv-1", 100, stopPromise);

  // waitForAllStopped 应等到 stopPromise resolve
  await registry.waitForAllStopped();
  assert(resolved, "waitForAllStopped should wait for registered stopPromise to resolve");
}

/** 多个 agent 并发场景：waitForAllStopped 等待所有 stopPromise resolve */
async function testRegisterStopPromiseMultipleAgents(): Promise<void> {
  const registry = new MessageInterruptRegistry();
  const resolved: number[] = [];

  for (let i = 1; i <= 3; i += 1) {
    const msgId = i;
    registry.registerStopPromise("conv-multi", msgId, new Promise<void>((resolve) => {
      setTimeout(() => { resolved.push(msgId); resolve(); }, 30 * msgId);
    }));
  }

  await registry.waitForAllStopped();
  assert(resolved.length === 3, "waitForAllStopped should wait for all 3 agents");
  assert(resolved.includes(1) && resolved.includes(2) && resolved.includes(3), "all agent stopPromises should have resolved");
}

/** finishMessage 清理 stopPromise 条目 */
function testFinishMessageCleansUpStopPromise(): void {
  const registry = new MessageInterruptRegistry();
  let resolveAgent!: () => void;
  const promise = new Promise<void>((r) => { resolveAgent = r; });

  registry.registerStopPromise("conv-cleanup", 200, promise);
  registry.finishMessage("conv-cleanup", 200);

  // finishMessage 后 stopPromise 不再被 waitForAllStopped 追踪
  // 即使 promise 未 resolve，waitForAllStopped 也不应阻塞
  let waited = false;
  registry.waitForAllStopped().then(() => { waited = true; });
  setTimeout(() => {
    assert(waited, "waitForAllStopped should not block on finished message's stopPromise");
    resolveAgent(); // cleanup
  }, 50);
}
