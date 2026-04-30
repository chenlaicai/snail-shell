import type { ChildProcess } from "child_process";
import { AgentInvocationInterruptedError, AgentInvocationTerminatedError, type AgentStopDetail, type AgentStopReason } from "./interface";
import { logger } from "../logger";

export interface ManagedProcessStopOptions {
  gracefulTimeoutMs?: number;
  terminateTimeoutMs?: number;
  killConfirmTimeoutMs?: number;
}

export interface ManagedProcessController {
  stopDetail(): AgentStopDetail | null;
  throwIfStopped(): void;
  cleanup(): void;
}

interface ProcessCloseState {
  closed: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  listeners: Array<() => void>;
}

interface StopTiming {
  gracefulTimeoutMs: number;
  terminateTimeoutMs: number;
  killConfirmTimeoutMs: number;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 15_000;
const DEFAULT_TERMINATE_TIMEOUT_MS = 5_000;
const DEFAULT_KILL_CONFIRM_TIMEOUT_MS = 2_000;

export function manageInvocationProcess(input: {
  proc: ChildProcess;
  agentName: string;
  signal?: AbortSignal;
  invocationTimeoutMs?: number;
  stopOptions?: ManagedProcessStopOptions;
}): ManagedProcessController {
  const { proc, agentName, signal, invocationTimeoutMs } = input;
  const timing = resolveStopTiming(input.stopOptions);
  const closeState: ProcessCloseState = { closed: false, code: null, signal: null, listeners: [] };
  const timers = new Set<NodeJS.Timeout>();
  let detail: AgentStopDetail | null = null;
  let cleaned = false;

  const onClose = (code: number | null, exitSignal: NodeJS.Signals | null) => handleProcessClose(closeState, detail, code, exitSignal);
  proc.once("close", onClose);

  const requestStop = (reason: AgentStopReason) => {
    if (detail || closeState.closed) return;
    detail = createStopDetail(reason, timing);
    startStopProtocol({ proc, agentName, detail, closeState, timers });
  };

  const abortListener = () => requestStop("user_interrupt");
  if (signal?.aborted) requestStop("user_interrupt");
  signal?.addEventListener("abort", abortListener, { once: true });

  if (invocationTimeoutMs && invocationTimeoutMs > 0) {
    const timeout = setManagedTimeout(timers, () => requestStop("system_timeout"), invocationTimeoutMs);
    timers.add(timeout);
  }

  return {
    stopDetail: () => detail,
    throwIfStopped: () => throwIfStopped(detail, agentName),
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      signal?.removeEventListener("abort", abortListener);
      proc.off("close", onClose);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

function resolveStopTiming(options: ManagedProcessStopOptions | undefined): StopTiming {
  return {
    gracefulTimeoutMs: options?.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS,
    terminateTimeoutMs: options?.terminateTimeoutMs ?? DEFAULT_TERMINATE_TIMEOUT_MS,
    killConfirmTimeoutMs: options?.killConfirmTimeoutMs ?? DEFAULT_KILL_CONFIRM_TIMEOUT_MS,
  };
}

function handleProcessClose(closeState: ProcessCloseState, detail: AgentStopDetail | null, code: number | null, exitSignal: NodeJS.Signals | null): void {
  closeState.closed = true;
  closeState.code = code;
  closeState.signal = exitSignal;
  if (detail) {
    detail.phase = "closed";
    detail.closed_at = new Date().toISOString();
    detail.exit_code = code;
    detail.exit_signal = exitSignal;
  }
  for (const listener of closeState.listeners.splice(0)) listener();
}

function createStopDetail(reason: AgentStopReason, timing: StopTiming): AgentStopDetail {
  return {
    reason,
    phase: "requested",
    requested_at: new Date().toISOString(),
    graceful_timeout_ms: timing.gracefulTimeoutMs,
    terminate_timeout_ms: timing.terminateTimeoutMs,
    kill_confirm_timeout_ms: timing.killConfirmTimeoutMs,
    forced: false,
    exit_code: null,
    exit_signal: null,
    process_group_signal_attempted: false,
    process_group_signal_error: null,
  };
}

function startStopProtocol(input: { proc: ChildProcess; agentName: string; detail: AgentStopDetail; closeState: ProcessCloseState; timers: Set<NodeJS.Timeout> }): void {
  if (input.proc.pid) {
    void stopProcess(input);
    return;
  }
  /**
   * spawn 失败或启动前已被 abort 时没有可操作的 OS 进程。
   * 仍然保留 stop detail，交给上层消息生命周期生成明确终态，避免请求已取消却丢失原因。
   */
  input.detail.phase = "kill_unconfirmed";
  input.detail.process_group_signal_error = "process was not spawned";
}

function throwIfStopped(detail: AgentStopDetail | null, agentName: string): void {
  if (!detail) return;
  if (detail.reason === "user_interrupt") throw new AgentInvocationInterruptedError("Agent invocation interrupted", detail);
  throw new AgentInvocationTerminatedError(`${agentName} invocation stopped: ${detail.reason}`, detail);
}

async function stopProcess(input: { proc: ChildProcess; agentName: string; detail: AgentStopDetail; closeState: ProcessCloseState; timers: Set<NodeJS.Timeout> }): Promise<void> {
  const { proc, agentName, detail, closeState, timers } = input;
  logger.warn(`${agentName} process stop requested`, { reason: detail.reason });
  detail.phase = "graceful_wait";
  sendProcessSignal(proc, "SIGINT", agentName, "graceful interrupt");
  if (await waitForClose(closeState, timers, detail.graceful_timeout_ms)) return;

  detail.phase = "terminate_sent";
  detail.forced = true;
  sendProcessSignal(proc, "SIGTERM", agentName, "termination");
  if (await waitForClose(closeState, timers, detail.terminate_timeout_ms)) return;

  detail.phase = "kill_sent";
  sendProcessTreeKill(proc, agentName, detail);
  if (await waitForClose(closeState, timers, detail.kill_confirm_timeout_ms)) return;
  detail.phase = "kill_unconfirmed";
  logger.error(`${agentName} process did not confirm exit after SIGKILL`, { reason: detail.reason });
}

function sendProcessSignal(proc: ChildProcess, signal: NodeJS.Signals, agentName: string, label: string): void {
  if (proc.killed) return;
  logger.warn(`${agentName} process ${label}, sending ${signal}`);
  proc.kill(signal);
}

function sendProcessTreeKill(proc: ChildProcess, agentName: string, detail: AgentStopDetail): void {
  detail.process_group_signal_attempted = true;
  const pid = proc.pid;
  try {
    if (pid) {
      process.kill(-pid, "SIGKILL");
      logger.warn(`${agentName} process group killed with SIGKILL`, { pid });
      return;
    }
  } catch (error) {
    detail.process_group_signal_error = error instanceof Error ? error.message : String(error);
    logger.warn(`${agentName} process group kill failed; falling back to child process kill`, { error: detail.process_group_signal_error });
  }
  proc.kill("SIGKILL");
}

function waitForClose(closeState: ProcessCloseState, timers: Set<NodeJS.Timeout>, timeoutMs: number): Promise<boolean> {
  if (closeState.closed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (closed: boolean) => {
      clearTimeout(timeout);
      timers.delete(timeout);
      const index = closeState.listeners.indexOf(onClose);
      if (index >= 0) closeState.listeners.splice(index, 1);
      resolve(closed);
    };
    const onClose = () => done(true);
    closeState.listeners.push(onClose);
    const timeout = setManagedTimeout(timers, () => done(false), timeoutMs);
  });
}

function setManagedTimeout(timers: Set<NodeJS.Timeout>, callback: () => void, timeoutMs: number): NodeJS.Timeout {
  const timeout = setTimeout(() => {
    timers.delete(timeout);
    callback();
  }, timeoutMs);
  timers.add(timeout);
  return timeout;
}
