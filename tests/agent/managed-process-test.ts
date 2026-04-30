import { spawn } from "child_process";
import { AgentInvocationInterruptedError, AgentInvocationTerminatedError } from "../../src/agent/interface";
import { manageInvocationProcess, type ProcessGroupProbe } from "../../src/agent/managed-process";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  await testUserInterruptWaitsForGracefulProcessGroupExit();
  await testSystemTimeoutEscalatesToForcedTermination();
  await testImmediateThrowWaitsForStopProtocolCompletion();
  await testCleanupDoesNotCancelStopProtocolCompletion();
  console.log("managed process tests passed");
}

async function testUserInterruptWaitsForGracefulProcessGroupExit(): Promise<void> {
  const controller = new AbortController();
  const proc = spawn(process.execPath, ["-e", "process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
  const managed = manageInvocationProcess({ proc, agentName: "TestAgent", signal: controller.signal, stopOptions: { gracefulTimeoutMs: 500, terminateTimeoutMs: 500, killConfirmTimeoutMs: 500 } });
  controller.abort();
  await waitForProcessClose(proc);
  await assertThrowsStopped(managed.throwIfStopped(), AgentInvocationInterruptedError, (detail) => {
    assert(detail, "interrupted error should include stop detail");
    assert(detail.reason === "user_interrupt", "user abort should retain stop reason");
    assert(detail.forced === false, "graceful SIGINT exit should not be marked forced");
    assert(detail.phase === "closed", "graceful exit should close the process group");
  });
  managed.cleanup();
}

async function testSystemTimeoutEscalatesToForcedTermination(): Promise<void> {
  const proc = spawn("/bin/sh", ["-c", "trap '' INT TERM; while true; do sleep 1; done"], { detached: true, stdio: "ignore" });
  const managed = manageInvocationProcess({ proc, agentName: "TestAgent", invocationTimeoutMs: 10, stopOptions: { gracefulTimeoutMs: 20, terminateTimeoutMs: 20, killConfirmTimeoutMs: 500 } });
  await waitForProcessClose(proc);
  await assertThrowsStopped(managed.throwIfStopped(), AgentInvocationTerminatedError, (detail) => {
    assert(detail.reason === "system_timeout", "timeout should retain stop reason");
    assert(detail.forced === true, "timeout escalation should be marked forced");
    assert(detail.process_group_signal_attempted === true, "forced timeout should attempt process group kill");
  });
  managed.cleanup();
}

async function testImmediateThrowWaitsForStopProtocolCompletion(): Promise<void> {
  const controller = new AbortController();
  const proc = spawn(process.execPath, ["-e", "process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
  const probe = createTimedProbe(120);
  const managed = manageInvocationProcess({ proc, agentName: "TestAgent", signal: controller.signal, processGroupProbe: probe, stopOptions: { gracefulTimeoutMs: 30, terminateTimeoutMs: 30, killConfirmTimeoutMs: 300 } });
  controller.abort();
  await waitForProcessClose(proc);
  const startedAt = Date.now();
  await assertThrowsStopped(managed.throwIfStopped(), AgentInvocationInterruptedError, (detail) => {
    assert(detail, "interrupted error should include stop detail");
    assert(Date.now() - startedAt >= 100, "throwIfStopped should wait for stop protocol completion before throwing");
    assert(detail.forced === true, "waiting stop protocol should still escalate while process group stays alive");
    assert(detail.phase === "closed", "throw should happen only after process group is confirmed closed");
  });
  managed.cleanup();
}

async function testCleanupDoesNotCancelStopProtocolCompletion(): Promise<void> {
  const controller = new AbortController();
  const proc = spawn(process.execPath, ["-e", "process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
  const managed = manageInvocationProcess({ proc, agentName: "TestAgent", signal: controller.signal, processGroupProbe: createTimedProbe(120), stopOptions: { gracefulTimeoutMs: 30, terminateTimeoutMs: 30, killConfirmTimeoutMs: 300 } });
  controller.abort();
  await waitForProcessClose(proc);
  managed.cleanup();
  await assertThrowsStopped(managed.throwIfStopped(), AgentInvocationInterruptedError, (detail) => {
    assert(detail, "interrupted error should include stop detail");
    assert(detail.forced === true, "cleanup after parent close must not cancel stop escalation");
    assert(detail.phase === "closed", "stop protocol should still complete after runtime cleanup");
  });
}

async function assertThrowsStopped<T extends typeof AgentInvocationInterruptedError | typeof AgentInvocationTerminatedError>(promise: Promise<void>, errorClass: T, validate: (detail: InstanceType<T>["detail"]) => void): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof errorClass, `expected ${errorClass.name}`);
    validate((error as InstanceType<T>).detail);
    return;
  }
  throw new Error(`expected ${errorClass.name}`);
}

function createTimedProbe(aliveMs: number): ProcessGroupProbe {
  const startedAt = Date.now();
  return { isAlive: () => Date.now() - startedAt < aliveMs };
}

function waitForProcessClose(proc: ReturnType<typeof spawn>): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => proc.once("close", () => resolve()));
}

void main();
