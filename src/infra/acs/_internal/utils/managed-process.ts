import type { ChildProcess } from "child_process";

// ═══════════════════════════════════════════════════════════
// 错误类型
// ═══════════════════════════════════════════════════════════

export type AgentStopReason = "user_interrupt" | "system_timeout" | "server_shutdown";

export interface AgentStopDetail {
  reason: AgentStopReason;
  phase: "requested" | "graceful_wait" | "terminate_sent" | "kill_sent" | "closed" | "kill_unconfirmed";
  requested_at: string;
  closed_at?: string | null;
  graceful_timeout_ms: number;
  terminate_timeout_ms: number;
  kill_confirm_timeout_ms: number;
  forced: boolean;
  exit_code?: number | null;
  exit_signal?: NodeJS.Signals | string | null;
  process_group_signal_attempted?: boolean;
  process_group_signal_error?: string | null;
}

export class AgentInvocationInterruptedError extends Error {
  readonly detail: AgentStopDetail | null;
  constructor(message = "Agent invocation interrupted", detail: AgentStopDetail | null = null) {
    super(message);
    this.name = "AgentInvocationInterruptedError";
    this.detail = detail;
  }
}

export class AgentInvocationTerminatedError extends Error {
  readonly detail: AgentStopDetail;
  constructor(message: string, detail: AgentStopDetail) {
    super(message);
    this.name = "AgentInvocationTerminatedError";
    this.detail = detail;
  }
}

// ═══════════════════════════════════════════════════════════
// 进程生命周期管理
// ═══════════════════════════════════════════════════════════

export interface ManagedProcessStopOptions {
  gracefulTimeoutMs?: number;
  terminateTimeoutMs?: number;
  killConfirmTimeoutMs?: number;
}

export interface ManagedProcessController {
  stopDetail(): AgentStopDetail | null;
  waitForStop(): Promise<void>;
  throwIfStopped(): Promise<void>;
  cleanup(): void;
}

export interface ProcessGroupProbe {
  isAlive(pid: number): boolean;
}

interface ProcessCloseState {
  closed: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface StopTiming {
  gracefulTimeoutMs: number;
  terminateTimeoutMs: number;
  killConfirmTimeoutMs: number;
}

interface StopContext {
  proc: ChildProcess;
  agentName: string;
  detail: AgentStopDetail;
  closeState: ProcessCloseState;
  processGroupProbe: ProcessGroupProbe;
  pid: number;
}

interface StopStage {
  phase: AgentStopDetail["phase"];
  signal: NodeJS.Signals;
  label: string;
  timeoutMs: number;
  forced: boolean;
}

interface StopState {
  detail: AgentStopDetail | null;
  promise: Promise<void> | null;
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
  const closeState: ProcessCloseState = { closed: false, code: null, signal: null };
  const timing = resolveStopTiming(input.stopOptions);
  const processGroupProbe = input.processGroupProbe ?? DEFAULT_PROCESS_GROUP_PROBE;
  const lifecycleTimers = new Set<NodeJS.Timeout>();
  const stopState: StopState = { detail: null, promise: null };
  const onClose = (code: number | null, exitSignal: NodeJS.Signals | null) => handleProcessClose(closeState, stopState.detail, code, exitSignal);
  input.proc.once("close", onClose);

  const requestStop = (reason: AgentStopReason) => {
    if (stopState.promise || closeState.closed) return;
    stopState.detail = createStopDetail(reason, timing);
    clearTimers(lifecycleTimers);
    stopState.promise = runStopProtocol({ ...input, closeState, detail: stopState.detail, processGroupProbe });
  };

  const abortListener = () => requestStop("user_interrupt");
  if (input.signal?.aborted) requestStop("user_interrupt");
  input.signal?.addEventListener("abort", abortListener, { once: true });
  if (input.invocationTimeoutMs && input.invocationTimeoutMs > 0) setManagedTimeout(lifecycleTimers, () => requestStop("system_timeout"), input.invocationTimeoutMs);

  return {
    stopDetail: () => stopState.detail,
    waitForStop: async () => { if (stopState.promise) await stopState.promise; },
    throwIfStopped: async () => {
      if (!stopState.detail) return;
      if (stopState.promise) await stopState.promise;
      throwStopped(stopState.detail, input.agentName);
    },
    cleanup: () => {
      input.signal?.removeEventListener("abort", abortListener);
      input.proc.off("close", onClose);
      clearTimers(lifecycleTimers);
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

function handleProcessClose(closeState: ProcessCloseState, detail: AgentStopDetail | null, code: number | null, exitSignal: NodeJS.Signals | null): void {
  closeState.closed = true;
  closeState.code = code;
  closeState.signal = exitSignal;
  if (!detail) return;
  detail.exit_code = code;
  detail.exit_signal = exitSignal;
}

const DEFAULT_PROCESS_GROUP_PROBE: ProcessGroupProbe = {
  isAlive: (pid: number) => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
};

async function runStopProtocol(input: { proc: ChildProcess; agentName: string; closeState: ProcessCloseState; detail: AgentStopDetail; processGroupProbe: ProcessGroupProbe }): Promise<void> {
  const pid = input.proc.pid;
  if (!pid) {
    markUnconfirmed(input.detail, "process was not spawned");
    return;
  }
  const context: StopContext = { ...input, pid };
  if (await runStopStage(context, { phase: "graceful_wait", signal: "SIGINT", label: "graceful interrupt", timeoutMs: input.detail.graceful_timeout_ms, forced: false })) return;
  if (await runStopStage(context, { phase: "terminate_sent", signal: "SIGTERM", label: "termination", timeoutMs: input.detail.terminate_timeout_ms, forced: true })) return;
  if (await runStopStage(context, { phase: "kill_sent", signal: "SIGKILL", label: "kill", timeoutMs: input.detail.kill_confirm_timeout_ms, forced: true })) return;
  markUnconfirmed(input.detail, null);
}

async function runStopStage(context: StopContext, stage: StopStage): Promise<boolean> {
  context.detail.phase = stage.phase;
  if (stage.forced) context.detail.forced = true;
  sendProcessTreeSignal(context, stage.signal, stage.label);
  if (!await waitForProcessGroupExit(context, stage.timeoutMs)) return false;
  context.detail.phase = "closed";
  context.detail.closed_at = new Date().toISOString();
  return true;
}

function sendProcessTreeSignal(context: StopContext, signal: NodeJS.Signals, _label: string): void {
  context.detail.process_group_signal_attempted = true;
  try {
    process.kill(-context.pid, signal);
  } catch (error) {
    context.detail.process_group_signal_error = error instanceof Error ? error.message : String(error);
    if (!context.proc.killed) context.proc.kill(signal);
  }
}

function waitForProcessGroupExit(context: StopContext, timeoutMs: number): Promise<boolean> {
  if (!context.processGroupProbe.isAlive(context.pid)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!context.processGroupProbe.isAlive(context.pid)) done(true);
    }, 20);
    const timeout = setTimeout(() => done(false), timeoutMs);
    const done = (result: boolean) => {
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(result);
    };
  });
}

function markUnconfirmed(detail: AgentStopDetail, error: string | null): void {
  detail.phase = "kill_unconfirmed";
  detail.process_group_signal_error = error;
}

function throwStopped(detail: AgentStopDetail, agentName: string): never {
  if (detail.reason === "user_interrupt") throw new AgentInvocationInterruptedError("Agent invocation interrupted", detail);
  throw new AgentInvocationTerminatedError(`${agentName} invocation stopped: ${detail.reason}`, detail);
}

function clearTimers(timers: Set<NodeJS.Timeout>): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

function setManagedTimeout(timers: Set<NodeJS.Timeout>, callback: () => void, timeoutMs: number): void {
  const timeout = setTimeout(() => {
    timers.delete(timeout);
    callback();
  }, timeoutMs);
  timers.add(timeout);
}
