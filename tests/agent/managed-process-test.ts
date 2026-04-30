import { spawn } from "child_process";
import { AgentInvocationInterruptedError, AgentInvocationTerminatedError } from "../../src/agent/interface";
import { manageInvocationProcess } from "../../src/agent/managed-process";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  await testUserInterruptWaitsForGracefulClose();
  await testSystemTimeoutEscalatesToForcedTermination();
  console.log("managed process tests passed");
}

async function testUserInterruptWaitsForGracefulClose(): Promise<void> {
  const controller = new AbortController();
  const proc = spawn(process.execPath, ["-e", "process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
  const managed = manageInvocationProcess({ proc, agentName: "TestAgent", signal: controller.signal, stopOptions: { gracefulTimeoutMs: 500, terminateTimeoutMs: 500, killConfirmTimeoutMs: 500 } });
  controller.abort();
  await waitForProcessClose(proc);
  let interrupted = false;
  try {
    managed.throwIfStopped();
  } catch (error) {
    interrupted = error instanceof AgentInvocationInterruptedError;
    const detail = error instanceof AgentInvocationInterruptedError ? error.detail : null;
    assert(detail?.reason === "user_interrupt", "user abort should retain stop reason");
    assert(detail?.forced === false, "graceful SIGINT exit should not be marked forced");
    assert(detail?.phase === "closed", "graceful exit should close the process");
  } finally {
    managed.cleanup();
  }
  assert(interrupted, "user abort should throw interrupted error after process closes");
}

async function testSystemTimeoutEscalatesToForcedTermination(): Promise<void> {
  const proc = spawn("/bin/sh", ["-c", "trap '' INT TERM; while true; do sleep 1; done"], { detached: true, stdio: "ignore" });
  const managed = manageInvocationProcess({ proc, agentName: "TestAgent", invocationTimeoutMs: 10, stopOptions: { gracefulTimeoutMs: 20, terminateTimeoutMs: 20, killConfirmTimeoutMs: 500 } });
  await waitForProcessClose(proc);
  let terminated = false;
  try {
    managed.throwIfStopped();
  } catch (error) {
    terminated = error instanceof AgentInvocationTerminatedError;
    const detail = error instanceof AgentInvocationTerminatedError ? error.detail : null;
    assert(detail?.reason === "system_timeout", "timeout should retain stop reason");
    assert(detail?.forced === true, "timeout escalation should be marked forced");
    assert(detail?.process_group_signal_attempted === true, "forced timeout should attempt process group kill");
  } finally {
    managed.cleanup();
  }
  assert(terminated, "system timeout should throw terminated error after process closes");
}

function waitForProcessClose(proc: ReturnType<typeof spawn>): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => proc.once("close", () => resolve()));
}

void main();
