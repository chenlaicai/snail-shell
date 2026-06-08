/**
 * Claude Code 有状态适配器 — 实现 SnailRuntime 接口。
 *
 * 封装 Claude Code CLI，支持会话恢复（--resume）。
 *
 * 首次调用（external_session_id 为空）：
 *   - --append-system-prompt-file 注入 systemPrompt
 *   - stdin 发送 bootstrap + incremental messages
 *   - 返回 session_id
 *
 * 后续调用（external_session_id 有值）：
 *   - --resume <session_id> 恢复会话
 *   - stdin 仅发送 incremental messages
 *   - systemReminder 按 hash 变化注入
 */

import { spawn, type ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import type { Readable } from 'stream';
import type { SnailRuntime, SnailRuntimeMessageInput, AgentInvocationResult, AgentInvocationOptions } from '../../runtime.js';
import type { AgentEvent } from '../../agent-event.js';
import type { AgentRuntime } from '../../types.js';
import { buildBootstrapMessages, buildIncrementalMessages, buildUserContent } from '../prompt-mapper.js';
import { manageInvocationProcess } from './managed-process.js';
import { buildDisallowedToolsArgs } from './guard-config.js';
import { ensureMcpServers } from './mcp-config.js';
import { ensureSkillSymlinks } from './skill-symlinks.js';
import { buildContextEnv } from './context-env.js';

export class ClaudeStatefulAdapter implements SnailRuntime {
  readonly name = 'claude-code-stateful';
  readonly runtime: AgentRuntime = 'claude-stateful';

  /** 按 session 跟踪 systemReminder hash，仅变化时注入 */
  private reminderHashBySession = new Map<string, string>();

  async invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult> {
    const isFirstCall = !input.external_session_id;

    // 确保 MCP 配置和 skill 符号链接
    ensureMcpServers(input.capability.mcpServers, input.workspace_root);
    ensureSkillSymlinks(input.workspace_root, input.capability.skills);

    // 构建消息
    const bootstrap = isFirstCall ? buildBootstrapMessages(input.history) : [];
    const incremental = buildIncrementalMessages(input);
    const effectiveReminder = this.resolveReminder(input.external_session_id, input.capability.systemReminder);
    const userContent = buildUserContent(effectiveReminder, bootstrap, incremental);

    // 写入 systemPrompt 临时文件（仅首次调用）
    let promptFilePath: string | null = null;
    if (isFirstCall && input.capability.systemPrompt) {
      promptFilePath = join(tmpdir(), `snail-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, input.capability.systemPrompt, 'utf-8');
    }

    // 构建 CLI 参数
    const args = this.buildArgs(input, options, promptFilePath);

    // 构建环境变量
    const contextEnv = buildContextEnv({
      conversation_id: input.conversation_id,
    });

    // 启动进程
    const proc = spawn('claude', args, {
      cwd: input.workspace_root,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ...contextEnv },
    });

    const processController = manageInvocationProcess({
      proc,
      agentName: this.name,
      signal: options?.signal,
      invocationTimeoutMs: options?.invocation_timeout_ms ?? input.capability.invocation_timeout_ms ?? 30 * 60 * 1000,
    });

    // 状态追踪：sessionId 初始为输入值，每次 agent 输出都可能更新
    const state = {
      sessionId: input.external_session_id ?? null,
      outputEventCount: 0,
      stderr: '',
    };

    // 设置 stderr 收集
    proc.stderr?.on('data', (data: Buffer) => {
      state.stderr += data.toString();
    });

    // 读取 stdout 并解析事件
    const outputDone = this.readOutput(proc, proc.stdout!, onEvent, state, options?.context_window);

    // 发送用户输入
    this.writeStdin(proc, {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: userContent }] },
    });

    // 等待输出完成
    await outputDone;
    proc.stdin?.end();

    // 等待进程关闭
    const closeDone = new Promise<void>((resolve) => {
      proc.once('close', () => {
        processController.cleanup();
        if (promptFilePath) {
          try { unlinkSync(promptFilePath); } catch { /* cleanup failure is non-fatal */ }
        }
        resolve();
      });
    });
    await closeDone;

    // 检查进程是否被中断
    await processController.throwIfStopped();

    // 验证结果
    if (proc.exitCode !== 0 && state.outputEventCount === 0) {
      throw new Error(`claude exited with code ${proc.exitCode}: ${state.stderr.slice(0, 500)}`);
    }

    // 更新 reminder hash：始终使用 agent 返回的最新 session_id
    const latestSessionId = state.sessionId;
    if (latestSessionId) {
      this.reminderHashBySession.set(latestSessionId, this.hashReminder(input.capability.systemReminder));
    }

    return {
      session_id: latestSessionId ?? undefined,
      wait_for_stop: () => processController.waitForStop(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CLI 参数构建
  // ═══════════════════════════════════════════════════════════

  private buildArgs(
    input: SnailRuntimeMessageInput,
    options: AgentInvocationOptions | undefined,
    promptFilePath: string | null,
  ): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
    ];

    // 模型覆盖
    const model = options?.model ?? input.capability.model;
    if (model) {
      args.push('--model', model);
    }

    // GuardProfile deny → --disallowedTools
    args.push(...buildDisallowedToolsArgs(input.capability.guardProfile));

    // MCP 配置路径
    args.push('--mcp-config', join(input.workspace_root, '.claude', 'mcp.json'));

    // 会话恢复
    if (input.external_session_id) {
      args.push('--resume', input.external_session_id);
    }

    // systemPrompt（仅首次调用）
    if (promptFilePath) {
      args.push('--append-system-prompt-file', promptFilePath);
    }

    return args;
  }

  // ═══════════════════════════════════════════════════════════
  // stdout 解析
  // ═══════════════════════════════════════════════════════════

  private readOutput(
    proc: ChildProcess,
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    state: { sessionId: string | null; outputEventCount: number; stderr: string },
    contextWindow?: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = '';

      stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = this.parseLine(line);
          if (!msg) continue;

          // 提取 session_id
          if (typeof msg.session_id === 'string' && msg.session_id) {
            state.sessionId = msg.session_id;
          }
          if (typeof msg.sessionID === 'string' && msg.sessionID) {
            state.sessionId = msg.sessionID;
          }

          // 处理消息
          this.processMessage(msg, onEvent, state, resolve, contextWindow);
        }
      });

      stdout.on('error', (error) => {
        reject(new Error(`stdout stream error: ${error.message}`));
      });

      stdout.on('end', () => resolve());
    });
  }

  private parseLine(line: string): any | null {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  private processMessage(
    msg: any,
    onEvent: (event: AgentEvent) => void,
    state: { outputEventCount: number },
    resolve: () => void,
    _contextWindow?: number,
  ): void {
    switch (msg.type) {
      case 'assistant':
        this.handleAssistantMessage(msg, onEvent, state);
        break;
      case 'result':
        this.handleResultMessage(msg, onEvent, state);
        resolve();
        break;
      default:
        break;
    }
  }

  private handleAssistantMessage(
    msg: any,
    onEvent: (event: AgentEvent) => void,
    state: { outputEventCount: number },
  ): void {
    for (const block of msg.message?.content ?? []) {
      if (block.type === 'text') {
        state.outputEventCount++;
        onEvent({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        state.outputEventCount++;
        onEvent({
          type: 'tool_call',
          tool_name: block.name,
          tool_call_id: block.id,
          arguments: block.input ?? undefined,
        });
      }
    }
  }

  private handleResultMessage(
    msg: any,
    onEvent: (event: AgentEvent) => void,
    state: { outputEventCount: number },
  ): void {
    // 发送 usage signal
    if (msg.usage || msg.duration_ms) {
      onEvent({
        type: 'signal',
        signal: 'runtime_usage',
        data: {
          input_tokens: msg.usage?.input_tokens,
          output_tokens: msg.usage?.output_tokens,
          cache_creation_input_tokens: msg.usage?.cache_creation_input_tokens,
          cache_read_input_tokens: msg.usage?.cache_read_input_tokens,
          duration_ms: msg.duration_ms,
          duration_api_ms: msg.duration_api_ms,
        },
      });
    }

    // permission_denials 记录但不阻塞
    const denials = Array.isArray(msg.permission_denials) ? msg.permission_denials : [];
    if (denials.length > 0) {
      onEvent({
        type: 'signal',
        signal: 'permission_blocked',
        data: { denials },
      });
    }

    // 错误结果
    if (msg.is_error) {
      const errorText = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
      onEvent({ type: 'error', message: errorText });
    }

    state.outputEventCount++;
  }

  // ═══════════════════════════════════════════════════════════
  // stdin 写入
  // ═══════════════════════════════════════════════════════════

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify(data) + '\n');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // systemReminder 变化检测
  // ═══════════════════════════════════════════════════════════

  private resolveReminder(sessionId: string | undefined, reminder: string): string {
    if (!sessionId) return reminder; // 首次调用，总是注入
    const hash = this.hashReminder(reminder);
    const lastHash = this.reminderHashBySession.get(sessionId);
    if (hash === lastHash) return ''; // 未变化，跳过
    return reminder;
  }

  private hashReminder(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
