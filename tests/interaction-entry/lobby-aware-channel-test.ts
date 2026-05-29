import { LobbyAwareChannel, type LobbyAwareChannelConfig, type LobbyAwareChannelDeps } from "../../src/interaction-entry/im-channel/lobby-aware-channel";
import type { FeishuInboundMessage, FeishuTransport } from "../../src/interaction-entry/feishu/channel";
import type { LobbySession } from "../../src/lobby/types";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createTestSession(overrides: Partial<LobbySession> = {}): LobbySession {
  return {
    id: "session-1",
    channel_type: "feishu",
    channel_chat_id: "chat-1",
    channel_tenant_key: "tenant-1",
    navigation_level: "in_conversation",
    current_project_id: "proj-1",
    current_feature_id: "feat-1",
    current_stage_id: "stage-1",
    current_conversation_id: "conv-1",
    last_command_at: "2026-05-29T00:00:00Z",
    created_at: "2026-05-29T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

class FakeTransport implements FeishuTransport {
  onMessage: ((message: FeishuInboundMessage) => void | Promise<void>) | null = null;
  readonly sent: Array<{ chatId: string; text: string; uuid?: string }> = [];

  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void {
    this.onMessage = input.onMessage;
  }

  sendText(input: { chatId: string; text: string; uuid?: string }): void {
    this.sent.push(input);
  }
}

/** 共享的订阅记录 Map，gateway.subscribe 和测试断言共用同一引用 */
const subscriptions = new Map<string, (event: unknown) => void>();

function createDeps(opts: {
  transport: FakeTransport;
  sessionStore: LobbyAwareChannelDeps["sessionStore"];
  router: LobbyAwareChannelDeps["lobbyRouter"];
  renderer: LobbyAwareChannelDeps["responseRenderer"];
}): LobbyAwareChannelDeps {
  return {
    transport: opts.transport,
    lobbyRouter: opts.router,
    gateway: {
      subscribe(conversationId: string, handler: (event: unknown) => void): () => void {
        subscriptions.set(conversationId, handler);
        return () => { subscriptions.delete(conversationId); };
      },
    } as unknown as LobbyAwareChannelDeps["gateway"],
    responseRenderer: opts.renderer,
    sessionStore: opts.sessionStore,
  };
}

async function runTests(): Promise<void> {
  // Test 1: rehydrate restores sessionToConversation so /back can unsubscribe
  {
    subscriptions.clear();
    const session = createTestSession({ current_conversation_id: "conv-1" });
    const transport = new FakeTransport();

    let currentSession = session;
    let forward = true;

    const router = {
      async processInbound() {
        if (forward) return { forwarded: true as const, session: currentSession };
        return { forwarded: false as const, session: currentSession, response: { text: "ok" } };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() {
        return [session];
      },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const deps = createDeps({
      transport,
      sessionStore: store,
      router,
      renderer: {} as unknown as LobbyAwareChannelDeps["responseRenderer"],
    });

    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 2000,
      includeUserMessages: false,
      lobbyBindings: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
    };
    const channel = new LobbyAwareChannel(config, deps);

    // Before start: no subscriptions
    assert(!subscriptions.has("conv-1"), "pre: no subscriptions before start");

    // Start triggers rehydrate — should restore subscription
    await channel.start();

    assert(subscriptions.has("conv-1"), "post-start: subscription restored for conv-1");

    // Simulate /lobby: session transitions from in_conversation to lobby
    const lobbySession = createTestSession({
      navigation_level: "lobby",
      current_conversation_id: null,
    });
    currentSession = lobbySession;
    forward = false;

    // Inbound /lobby message triggers handleSubscriptionCleanup.
    // Because sessionToConversation was restored by rehydrate, previousConversationId = "conv-1"
    // So ensureUnsubscribed("conv-1", "chat-1") should fire.
    await transport.onMessage?.({
      chatId: "chat-1",
      tenantKey: "tenant-1",
      messageId: "msg-lobby",
      text: "/lobby",
    });

    assert(!subscriptions.has("conv-1"), "post-lobby: conv-1 subscription should be unsubscribed");
    channel.stop();
  }

  // Test 2: rehydrate skips sessions not in lobby_bindings
  {
    subscriptions.clear();
    const session = createTestSession({ channel_chat_id: "chat-other" });
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() {
        return [session];
      },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const deps = createDeps({
      transport,
      sessionStore: store,
      router,
      renderer: {} as unknown as LobbyAwareChannelDeps["responseRenderer"],
    });

    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 2000,
      includeUserMessages: false,
      lobbyBindings: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    assert(!subscriptions.has("conv-1"), "should not subscribe chat not in bindings");
    channel.stop();
  }

  // Test 3: rehydrate skips sessions without current_conversation_id
  {
    subscriptions.clear();
    const session = createTestSession({ current_conversation_id: null, navigation_level: "lobby" });
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() {
        return [session];
      },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const deps = createDeps({
      transport,
      sessionStore: store,
      router,
      renderer: {} as unknown as LobbyAwareChannelDeps["responseRenderer"],
    });

    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 2000,
      includeUserMessages: false,
      lobbyBindings: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    assert(subscriptions.size === 0, "should not subscribe session without conversation_id");
    channel.stop();
  }

  console.log("lobby-aware-channel tests passed");
}

runTests().catch((err) => { console.error(err); process.exit(1); });
