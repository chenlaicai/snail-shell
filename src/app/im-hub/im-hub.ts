import type { CollaborationConsumer, CollaborationInput } from "@app/issue-collaboration/port";
import type { StagePort } from "@domain/issue/port";
import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { IMAdapter } from "@domain/im/_internal/adapter";
import type { LobbyAdapter } from "@domain/im/_internal/lobby-adapter";
import type { ChannelType } from "@domain/im/model";

interface IMHubDeps {
  imAdapter: IMAdapter;
  lobbyAdapter: LobbyAdapter;
  collaboration: CollaborationInput;
  stagePort: StagePort;
}

export class IMHub {
  private readonly consumers = new Map<string, { issueId: string; consumer: IMStageConsumer }>();

  constructor(private readonly deps: IMHubDeps) {}

  async forwardStageMessage(params: {
    channelType: ChannelType;
    chatId: string;
    tenantKey: string | null;
    stageId: string;
    text: string;
  }): Promise<void> {
    this.ensureConsumer(params.channelType, params.chatId, params.tenantKey, params.stageId);
    await this.deps.collaboration.sendMessage(params.stageId, params.text, "user");
  }

  rehydrateConsumers(): void {
    for (const channel of this.deps.imAdapter.listChannelConfigs()) {
      for (const session of this.deps.lobbyAdapter.getInStageSessions(channel.type)) {
        if (session.current_stage_id) {
          this.ensureConsumer(session.channel_type, session.channel_chat_id, session.channel_tenant_key, session.current_stage_id);
        }
      }
    }
  }

  private ensureConsumer(channelType: ChannelType, chatId: string, tenantKey: string | null, stageId: string): void {
    const stage = this.deps.stagePort.findStage(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    const chatKey = `${channelType}:${tenantKey ?? ""}:${chatId}`;
    const key = `${chatKey}:${stage.issue_id}`;
    if (this.consumers.has(key)) {
      return;
    }

    this.unregisterOtherIssueConsumers(chatKey, stage.issue_id);
    const consumer = new IMStageConsumer(this.deps.imAdapter, channelType, chatId);
    this.deps.collaboration.registerIssueConsumer(stage.issue_id, consumer);
    this.consumers.set(key, { issueId: stage.issue_id, consumer });
  }

  private unregisterOtherIssueConsumers(chatKey: string, issueId: string): void {
    for (const [key, entry] of this.consumers) {
      if (!key.startsWith(`${chatKey}:`) || entry.issueId === issueId) continue;
      this.deps.collaboration.unregisterIssueConsumer(entry.issueId, entry.consumer);
      this.consumers.delete(key);
    }
  }
}

class IMStageConsumer implements CollaborationConsumer {
  private readonly streamingMessages = new Map<number, { imMessageId: string; text: string }>();

  constructor(
    private readonly imAdapter: IMAdapter,
    private readonly channelType: ChannelType,
    private readonly chatId: string,
  ) {}

  async onMessageStarted(_stageId: string, message: Message): Promise<void> {
    if (message.status !== "streaming") {
      return;
    }
    const channel = this.mustGetChannel();
    const text = `[${message.from_speaker ?? "agent"}] working...`;
    const imMessageId = await channel.sendText(this.chatId, text);
    this.streamingMessages.set(message.id, { imMessageId, text });
  }

  async onEvent(_stageId: string, event: MessageEvent): Promise<void> {
    if (event.payload.type !== "text") {
      return;
    }

    const state = this.streamingMessages.get(event.message_id);
    const channel = this.mustGetChannel();
    if (!state) {
      await channel.sendText(this.chatId, event.payload.text);
      return;
    }

    state.text += event.payload.text;
    if (channel.patchText) {
      await channel.patchText(state.imMessageId, state.text);
      return;
    }
    await channel.sendText(this.chatId, event.payload.text);
  }

  async onMessageCompleted(_stageId: string, message: Message, context: MessageContext | null): Promise<void> {
    const finalText = context?.context;
    if (!finalText) {
      this.streamingMessages.delete(message.id);
      return;
    }

    const channel = this.mustGetChannel();
    const text = `[${message.from_speaker ?? "agent"}] ${finalText}`;
    const state = this.streamingMessages.get(message.id);
    this.streamingMessages.delete(message.id);

    if (state && channel.patchText) {
      await channel.patchText(state.imMessageId, text);
      return;
    }
    await channel.sendText(this.chatId, text);
  }

  async onUserCalled(_stageId: string, message: Message): Promise<void> {
    await this.mustGetChannel().sendText(this.chatId, `[${message.from_speaker ?? "agent"}] 需要用户确认或补充。`);
  }

  async onStageTransitionSuggested(_stageId: string): Promise<void> {
    await this.mustGetChannel().sendText(this.chatId, "Agent 提出了 Stage 转换建议，请在支持确认的界面中确认后推进。");
  }

  private mustGetChannel() {
    const channel = this.imAdapter.getChannel(this.channelType);
    if (!channel) {
      throw new Error(`IM channel not found: ${this.channelType}`);
    }
    return channel;
  }
}
