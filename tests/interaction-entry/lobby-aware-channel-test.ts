import { LobbyAwareChannel, type LobbyAwareChannelConfig, type LobbyAwareChannelDeps } from "../../src/interaction-entry/im-channel/lobby-aware-channel";
import type { FeishuInboundMessage, FeishuTransport } from "../../src/interaction-entry/feishu/types";
import type { LobbySession } from "../../src/lobby/types";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function createTestSession(overrides: Partial<LobbySession> = {}): LobbySession {
  return {
    id: "session-1",
    channel_type: "feishu",
    channel_chat_id: "chat-1",
    channel_tenant_key: "tenant-1",
    navigation_level: "in_conversation",
    current_workspace_id: "proj-1",
    current_issue_id: "issue-1",
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
  readonly patched: Array<{ messageId: string; text: string }> = [];
  private nextMessageId = 1;

  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void {
    this.onMessage = input.onMessage;
  }

  async sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string> {
    this.sent.push(input);
    return `fake-msg-${this.nextMessageId++}`;
  }

  async patchText(input: { messageId: string; text: string }): Promise<void> {
    this.patched.push(input);
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
        if (forward) return { forwarded: true as const, session: currentSession, messageIds: [] };
        return { session: currentSession, response: { text: "ok" } };
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

      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
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
    transport.onMessage?.({
      chatId: "chat-1",
      tenantKey: "tenant-1",
      messageId: "msg-lobby",
      text: "/lobby",
    });

    await waitFor(() => !subscriptions.has("conv-1"), "post-lobby: conv-1 subscription should be unsubscribed");
    channel.stop();
  }

  // Test 2: rehydrate skips sessions not in lobby_bindings
  {
    subscriptions.clear();
    const session = createTestSession({ channel_chat_id: "chat-other" });
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session, messageIds: [] };
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

      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
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
        return { forwarded: true as const, session, messageIds: [] };
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

      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    assert(subscriptions.size === 0, "should not subscribe session without conversation_id");
    channel.stop();
  }

  // Test 4: per-chat echo prevention — Boss Role message from chat-1 should not echo back to chat-1
  {
    subscriptions.clear();
    const session = createTestSession();
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session, messageIds: [42] };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() { return [session]; },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const renderer = {
      renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }) {
        return `${input.roleName}: ${input.text}`;
      },
    } as unknown as LobbyAwareChannelDeps["responseRenderer"];

    const deps = createDeps({ transport, sessionStore: store, router, renderer });
    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 2000,
      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    // Forward a message from chat-1 (messageIds: [42])
    transport.onMessage?.({ chatId: "chat-1", tenantKey: "tenant-1", messageId: "msg-fwd", text: "hello" });
    await waitFor(() => subscriptions.has("conv-1"), "should subscribe conv-1 after forward");

    // Simulate outbound Boss Role event with message_id=42 (same as forwarded)
    const handler = subscriptions.get("conv-1")!;
    handler({
      type: "message_event_appended",
      conversation_id: "conv-1",
      message_id: 42,
      role_name: "项目负责人",
      event: { id: 1, message_id: 42, seq: 1, category: "content", kind: "text", payload: { text: "echo test" }, source: {}, created_at: new Date().toISOString() },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert(transport.sent.length === 0, "Boss Role echo from same chat should be suppressed");

    // Now simulate outbound Boss Role event with different message_id (from Web UI) — should be sent
    handler({
      type: "message_event_appended",
      conversation_id: "conv-1",
      message_id: 99,
      role_name: "项目负责人",
      event: { id: 2, message_id: 99, seq: 2, category: "content", kind: "text", payload: { text: "web ui input" }, source: {}, created_at: new Date().toISOString() },
    });
    await waitFor(() => transport.sent.length === 1, "Boss Role from different source should be synced");

    assert(transport.sent[0]?.text.includes("web ui input"), "cross-chat Boss Role message should include content");

    channel.stop();
  }

  // Test 5: echo prevention timing fix — pendingForwardChatId suppresses echo during synchronous emit
  // Simulates the real scenario: gateway.sendMessage synchronously emits message_event_appended
  // during router.processInbound(), before trackForwardedMessages is called.
  {
    subscriptions.clear();
    const session = createTestSession();
    const transport = new FakeTransport();

    let outboundHandler: ((event: unknown) => void) | null = null;

    const router = {
      async processInbound() {
        // Simulate gateway.sendMessage synchronous emit:
        // The subscription handler fires DURING processInbound, before trackForwardedMessages
        if (outboundHandler) {
          outboundHandler({
            type: "message_event_appended",
            conversation_id: "conv-1",
            message_id: 55,
            role_name: "项目负责人",
            event: { id: 1, message_id: 55, seq: 1, category: "content", kind: "text", payload: { text: "hi" }, source: {}, created_at: new Date().toISOString() },
          });
        }
        return { forwarded: true as const, session, messageIds: [55] };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() { return [session]; },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const renderer = {
      renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }) {
        return `${input.roleName}: ${input.text}`;
      },
    } as unknown as LobbyAwareChannelDeps["responseRenderer"];

    const deps = createDeps({ transport, sessionStore: store, router, renderer });
    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 2000,
      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
    };
    const channel = new LobbyAwareChannel(config, deps);

    // Start triggers rehydrate — restores subscription for conv-1
    await channel.start();
    assert(subscriptions.has("conv-1"), "pre: subscription should exist after rehydrate");

    // Capture the outbound handler so the router can trigger it synchronously
    outboundHandler = subscriptions.get("conv-1")!;

    // Send a message from chat-1 — the router will synchronously emit a Boss Role event
    transport.onMessage?.({ chatId: "chat-1", tenantKey: "tenant-1", messageId: "msg-timing", text: "hi" });

    // Wait for the async inbound processing to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The Boss Role event fired synchronously during processInbound should have been suppressed
    assert(transport.sent.length === 0, "echo should be suppressed via pendingForwardChatId during synchronous emit");

    channel.stop();
  }

  console.log("lobby-aware-channel tests passed");
}

async function runStreamingTests(): Promise<void> {
  // Test 6: streaming enabled — message_started sends placeholder via sendText
  {
    subscriptions.clear();
    const session = createTestSession();
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session, messageIds: [] };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() { return [session]; },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const renderer = {
      renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }) {
        return `${input.roleName}: ${input.text}`;
      },
    } as unknown as LobbyAwareChannelDeps["responseRenderer"];

    const deps = createDeps({ transport, sessionStore: store, router, renderer });
    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 4000,
      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
      streamingEnabled: true,
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    // Forward a message to subscribe to conv-1
    transport.onMessage?.({ chatId: "chat-1", tenantKey: "tenant-1", messageId: "msg-stream", text: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const handler = subscriptions.get("conv-1")!;

    // Simulate message_started event
    handler({
      type: "message_started",
      conversation_id: "conv-1",
      message_id: 100,
      role_name: "Agent",
      status: "streaming",
      role: "assistant",
    });
    // handleStreamingStarted is async, wait for the full chain (onStart → sendText)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // sendText should have been called with placeholder
    assert(transport.sent.some((s) => s.text.includes("思考中")), "streaming: placeholder should be sent on message_started");

    channel.stop();
  }

  // Test 7: streaming enabled — message_event_appended routes to session (no extra sendText)
  {
    subscriptions.clear();
    const session = createTestSession();
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session, messageIds: [] };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() { return [session]; },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const renderer = {
      renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }) {
        return `${input.roleName}: ${input.text}`;
      },
    } as unknown as LobbyAwareChannelDeps["responseRenderer"];

    const deps = createDeps({ transport, sessionStore: store, router, renderer });
    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 4000,
      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
      streamingEnabled: true,
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    transport.onMessage?.({ chatId: "chat-1", tenantKey: "tenant-1", messageId: "msg-stream2", text: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const handler = subscriptions.get("conv-1")!;

    // Start streaming session
    handler({
      type: "message_started",
      conversation_id: "conv-1",
      message_id: 200,
      role_name: "Agent",
      status: "streaming",
      role: "assistant",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const sentBefore = transport.sent.length;

    // Send text delta — should NOT create a new sendText (routed to session buffer)
    handler({
      type: "message_event_appended",
      conversation_id: "conv-1",
      message_id: 200,
      role_name: "Agent",
      event: { id: 1, message_id: 200, seq: 1, category: "content", kind: "text", payload: { text: "hello" }, source: {}, created_at: new Date().toISOString() },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert(transport.sent.length === sentBefore, "streaming: text delta should not trigger sendText (buffered in session)");

    channel.stop();
  }

  // Test 8: streaming disabled — message_started is ignored (legacy path)
  {
    subscriptions.clear();
    const session = createTestSession();
    const transport = new FakeTransport();

    const router = {
      async processInbound() {
        return { forwarded: true as const, session, messageIds: [] };
      },
    } as unknown as LobbyAwareChannelDeps["lobbyRouter"];

    const store = {
      getActiveConversations() { return [session]; },
    } as unknown as LobbyAwareChannelDeps["sessionStore"];

    const renderer = {
      renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }) {
        return `${input.roleName}: ${input.text}`;
      },
    } as unknown as LobbyAwareChannelDeps["responseRenderer"];

    const deps = createDeps({ transport, sessionStore: store, router, renderer });
    const config: LobbyAwareChannelConfig = {
      channelType: "feishu",
      maxTextLength: 4000,
      allowedChats: [{ chat_id: "chat-1", tenant_key: "tenant-1" }],
      streamingEnabled: false,
    };
    const channel = new LobbyAwareChannel(config, deps);
    await channel.start();

    transport.onMessage?.({ chatId: "chat-1", tenantKey: "tenant-1", messageId: "msg-legacy", text: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const handler = subscriptions.get("conv-1")!;

    // message_started should be ignored in legacy mode
    handler({
      type: "message_started",
      conversation_id: "conv-1",
      message_id: 300,
      role_name: "Agent",
      status: "streaming",
      role: "assistant",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert(transport.sent.length === 0, "legacy: message_started should be ignored when streaming disabled");

    // message_event_appended should trigger sendText in legacy mode
    handler({
      type: "message_event_appended",
      conversation_id: "conv-1",
      message_id: 300,
      role_name: "Agent",
      event: { id: 1, message_id: 300, seq: 1, category: "content", kind: "text", payload: { text: "response" }, source: {}, created_at: new Date().toISOString() },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert(transport.sent.some((s) => s.text.includes("response")), "legacy: text event should trigger sendText");

    channel.stop();
  }

  console.log("lobby-aware-channel streaming tests passed");
}

runTests()
  .then(() => runStreamingTests())
  .catch((err) => { console.error(err); process.exit(1); });
