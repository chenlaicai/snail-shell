/**
 * Agent 子进程生命周期管理。
 *
 * 职责：
 * - 监听 AbortSignal，触发优雅关闭
 * - 超时保护（invocation_timeout_ms）
 * - 三阶段关闭协议：SIGINT → SIGTERM → SIGKILL
 * - 进程组信号（kill(-pid, signal)）确保子进程树被清理
 */

import type { ChildProcess } from 'child_process';

/** Agent 停止详情（managed-process 内部使用） */
interface AgentStopDetail {
  reason: 'user_interrupt' | 'system_timeout' | 'server_shutdown';
  phase: 'requested' | 'graceful_wait' | 'terminate_sent' | 'kill_sent' | 'closed';
  exit_code?: number | null;
  exit_signal?: NodeJS.Signals | string | null;
  forced?: boolean;
}

// ═══════════════════════════════════════════════════════════
// 错误类型
// ═══════════════════════════════════════════════════════════

export class AgentInvocationInterruptedError extends Error {
  readonly detail: AgentStopDetail;
  constructor(message = 'Agent invocation interrupted', detail: AgentStopDetail) {
    super(message);
    this.name = 'AgentInvocationInterruptedError';
    this.detail = detail;
  }
}

export class AgentInvocationTerminatedError extends Error {
  readonly detail: AgentStopDetail;
  constructor(message: string, detail: AgentStopDetail) {
    super(message);
    this.name = 'AgentInvocationTerminatedError';
    this.detail = detail;
  }
}

// ═══════════════════════════════════════════════════════════
// ManagedProcessController
// ═══════════════════════════════════════════════════════════

export interface ManagedProcessController {
  waitForStop(): Promise<void>;
  throwIfStopped(): Promise<void>;
  cleanup(): void;
}

const GRACEFUL_TIMEOUT_MS = 15_000;
const TERMINATE_TIMEOUT_MS = 5_000;
const KILL_CONFIRM_TIMEOUT_MS = 2_000;

interface CloseState {
  closed: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface StopState {
  detail: AgentStopDetail | null;
  promise: Promise<void> | null;
}

export function manageInvocationProcess(input: {
  proc: ChildProcess;
  agentName: string;
  signal?: AbortSignal;
  invocationTimeoutMs?: number;
}): ManagedProcessController {
  const closeState: CloseState = { closed: false, code: null, signal: null };
  const stopState: StopState = { detail: null, promise: null };
  const lifecycleTimers = new Set<ReturnType<typeof setTimeout>>();

  const onClose = (code: number | null, exitSignal: NodeJS.Signals | null) => {
    closeState.closed = true;
    closeState.code = code;
    closeState.signal = exitSignal;
    if (stopState.detail) {
      stopState.detail.exit_code = code;
      stopState.detail.exit_signal = exitSignal;
    }
  };
  input.proc.once('close', onClose);

  const requestStop = (reason: AgentStopDetail['reason']) => {
    if (stopState.promise || closeState.closed) return;
    stopState.detail = createStopDetail(reason);
    clearTimers(lifecycleTimers);
    stopState.promise = runStopProtocol(input.proc, input.agentName, stopState.detail);
  };

  // AbortSignal 监听
  const abortListener = () => requestStop('user_interrupt');
  if (input.signal?.aborted) requestStop('user_interrupt');
  input.signal?.addEventListener('abort', abortListener, { once: true });

  // 超时保护
  if (input.invocationTimeoutMs && input.invocationTimeoutMs > 0) {
    const timer = setTimeout(() => requestStop('system_timeout'), input.invocationTimeoutMs);
    lifecycleTimers.add(timer);
  }

  return {
    waitForStop: async () => {
      if (stopState.promise) await stopState.promise;
    },
    throwIfStopped: async () => {
      if (!stopState.detail) return;
      if (stopState.promise) await stopState.promise;
      throwStopped(stopState.detail, input.agentName);
    },
    cleanup: () => {
      input.signal?.removeEventListener('abort', abortListener);
      input.proc.off('close', onClose);
      clearTimers(lifecycleTimers);
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 内部实现
// ═══════════════════════════════════════════════════════════

function createStopDetail(reason: AgentStopDetail['reason']): AgentStopDetail {
  return {
    reason,
    phase: 'requested',
    exit_code: null,
    exit_signal: null,
  };
}

async function runStopProtocol(proc: ChildProcess, agentName: string, detail: AgentStopDetail): Promise<void> {
  const pid = proc.pid;
  if (!pid) {
    detail.phase = 'closed';
    return;
  }

  console.warn(`[${agentName}] stop requested: ${detail.reason}`);

  // Stage 1: SIGINT (graceful)
  detail.phase = 'graceful_wait';
  sendSignal(pid, 'SIGINT', agentName);
  if (await waitForExit(pid, GRACEFUL_TIMEOUT_MS)) {
    detail.phase = 'closed';
    return;
  }

  // Stage 2: SIGTERM (terminate)
  detail.phase = 'terminate_sent';
  detail.forced = true;
  sendSignal(pid, 'SIGTERM', agentName);
  if (await waitForExit(pid, TERMINATE_TIMEOUT_MS)) {
    detail.phase = 'closed';
    return;
  }

  // Stage 3: SIGKILL (kill)
  detail.phase = 'kill_sent';
  sendSignal(pid, 'SIGKILL', agentName);
  if (await waitForExit(pid, KILL_CONFIRM_TIMEOUT_MS)) {
    detail.phase = 'closed';
    return;
  }

  detail.phase = 'closed';
  console.error(`[${agentName}] process did not exit after SIGKILL`);
}

function sendSignal(pid: number, signal: NodeJS.Signals, agentName: string): void {
  try {
    // 负 PID = 发送给整个进程组
    process.kill(-pid, signal);
  } catch {
    // 进程组信号失败，回退到单进程信号
    try {
      process.kill(pid, signal);
    } catch {
      // 进程已退出
    }
  }
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(true);
      }
    }, 20);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, timeoutMs);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function throwStopped(detail: AgentStopDetail, agentName: string): never {
  if (detail.reason === 'user_interrupt') {
    throw new AgentInvocationInterruptedError('Agent invocation interrupted', detail);
  }
  throw new AgentInvocationTerminatedError(`${agentName} stopped: ${detail.reason}`, detail);
}

function clearTimers(timers: Set<ReturnType<typeof setTimeout>>): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}
