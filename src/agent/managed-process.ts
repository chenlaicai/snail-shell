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

export interface ProcessGroupProbe {
  isAlive(pid: number): boolean;
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

interface StopProcessContext {
  proc: ChildProcess;
  agentName: string;
  detail: AgentStopDetail;
  closeState: ProcessCloseState;
  processGroupProbe: ProcessGroupProbe;
  pid: number;
  stopTimers: Set<NodeJS.Timeout>;
}

interface StopStage {
  phase: AgentStopDetail["phase"];
  signal: NodeJS.Signals;
  label: string;
  timeoutMs: number;
  forced: boolean;
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
  processGroupProbe?: ProcessGroupProbe;
}): ManagedProcessController {
  const { proc, agentName, signal, invocationTimeoutMs } = input;
  const timing = resolveStopTiming(input.stopOptions);
  const closeState: ProcessCloseState = { closed: false, code: null, signal: null, listeners: [] };
  const lifecycleTimers = new Set<NodeJS.Timeout>();
  const stopTimers = new Set<NodeJS.Timeout>();
  let detail: AgentStopDetail | null = null;
  let cleaned = false;

  const onClose = (code: number | null, exitSignal: NodeJS.Signals | null) => handleProcessClose(closeState, detail, code, exitSignal);
  proc.once("close", onClose);

  const requestStop = (reason: AgentStopReason) => {
    if (detail || closeState.closed) return;
    detail = createStopDetail(reason, timing);
    startStopProtocol({ proc, agentName, detail, closeState, lifecycleTimers, stopTimers, processGroupProbe: input.processGroupProbe ?? DEFAULT_PROCESS_GROUP_PROBE });
  };

  const abortListener = () => requestStop("user_interrupt");
  if (signal?.aborted) requestStop("user_interrupt");
  signal?.addEventListener("abort", abortListener, { once: true });

  if (invocationTimeoutMs && invocationTimeoutMs > 0) {
    setManagedTimeout(lifecycleTimers, () => requestStop("system_timeout"), invocationTimeoutMs);
  }

  return {
    stopDetail: () => detail,
    throwIfStopped: () => throwIfStopped(detail, agentName),
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      signal?.removeEventListener("abort", abortListener);
      proc.off("close", onClose);
      clearTimers(lifecycleTimers);
      if (!detail || detail.phase === "closed" || detail.phase === "kill_unconfirmed") clearTimers(stopTimers);
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

const DEFAULT_PROCESS_GROUP_PROBE: ProcessGroupProbe = {
  isAlive: (pid: number) => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "EPERM";
    }
  },
};

function startStopProtocol(input: { proc: ChildProcess; agentName: string; detail: AgentStopDetail; closeState: ProcessCloseState; lifecycleTimers: Set<NodeJS.Timeout>; stopTimers: Set<NodeJS.Timeout>; processGroupProbe: ProcessGroupProbe }): void {
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

async function stopProcess(input: { proc: ChildProcess; agentName: string; detail: AgentStopDetail; closeState: ProcessCloseState; lifecycleTimers: Set<NodeJS.Timeout>; stopTimers: Set<NodeJS.Timeout>; processGroupProbe: ProcessGroupProbe }): Promise<void> {
  const { proc, agentName, detail, closeState, lifecycleTimers, stopTimers, processGroupProbe } = input;
  const pid = proc.pid;
  if (!pid) return;
  clearTimers(lifecycleTimers);
  const context: StopProcessContext = { proc, agentName, detail, closeState, processGroupProbe, pid, stopTimers };
  logger.warn(`${agentName} process stop requested`, { reason: detail.reason });
  if (await runStopStage(context, { phase: "graceful_wait", signal: "SIGINT", label: "graceful interrupt", timeoutMs: detail.graceful_timeout_ms, forced: false })) return;
  if (await runStopStage(context, { phase: "terminate_sent", signal: "SIGTERM", label: "termination", timeoutMs: detail.terminate_timeout_ms, forced: true })) return;
  if (await runStopStage(context, { phase: "kill_sent", signal: "SIGKILL", label: "kill", timeoutMs: detail.kill_confirm_timeout_ms, forced: true })) return;
  detail.phase = "kill_unconfirmed";
  clearTimers(stopTimers);
  logger.error(`${agentName} process did not confirm exit after SIGKILL`, { reason: detail.reason });
}

async function runStopStage(context: StopProcessContext, stage: StopStage): Promise<boolean> {
  context.detail.phase = stage.phase;
  if (stage.forced) context.detail.forced = true;
  sendProcessTreeSignal(context, stage.signal, stage.label);
  if (!await waitForProcessGroupExit(context, stage.timeoutMs)) return false;
  finishStopProtocol(context);
  return true;
}

function finishStopProtocol(context: StopProcessContext): void {
  context.detail.phase = "closed";
  context.detail.closed_at = new Date().toISOString();
  clearTimers(context.stopTimers);
}

function sendProcessTreeSignal(context: StopProcessContext, signal: NodeJS.Signals, label: string): void {
  context.detail.process_group_signal_attempted = true;
  logger.warn(`${context.agentName} process group ${label}, sending ${signal}`);
  try {
    process.kill(-context.pid, signal);
    return;
  } catch (error) {
    context.detail.process_group_signal_error = error instanceof Error ? error.message : String(error);
    logger.warn(`${context.agentName} process group signal failed; falling back to child process signal`, { signal, error: context.detail.process_group_signal_error });
  }
  if (!context.proc.killed) context.proc.kill(signal);
}

function waitForProcessGroupExit(context: StopProcessContext, timeoutMs: number): Promise<boolean> {
  if (!context.processGroupProbe.isAlive(context.pid)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (closed: boolean) => {
      clearTimeout(timeout);
      clearInterval(interval);
      context.stopTimers.delete(timeout);
      const index = context.closeState.listeners.indexOf(onClose);
      if (index >= 0) context.closeState.listeners.splice(index, 1);
      resolve(closed);
    };
    const onClose = () => {
      if (!context.processGroupProbe.isAlive(context.pid)) done(true);
    };
    const interval = setInterval(() => {
      if (!context.processGroupProbe.isAlive(context.pid)) done(true);
    }, 20);
    context.closeState.listeners.push(onClose);
    const timeout = setManagedTimeout(context.stopTimers, () => done(false), timeoutMs);
  });
}

function clearTimers(timers: Set<NodeJS.Timeout>): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

function setManagedTimeout(timers: Set<NodeJS.Timeout>, callback: () => void, timeoutMs: number): NodeJS.Timeout {
  const timeout = setTimeout(() => {
    timers.delete(timeout);
    callback();
  }, timeoutMs);
  timers.add(timeout);
  return timeout;
}
