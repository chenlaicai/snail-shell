import { FeishuStreamingSession } from "../../src/interaction-entry/feishu/streaming-session";
import type { IMTransport } from "../../src/interaction-entry/im-channel/types";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class MockTransport implements IMTransport {
  readonly sent: Array<{ chatId: string; text: string; uuid?: string }> = [];
  readonly patched: Array<{ messageId: string; text: string }> = [];
  private nextMessageId = 1;
  /** 控制 sendText 行为 */
  sendTextFn: ((input: { chatId: string; text: string }) => Promise<string>) | null = null;
  /** 控制 patchText 行为 */
  patchTextFn: ((input: { messageId: string; text: string }) => Promise<void>) | null = null;

  async prepare(): Promise<void> {}
  onMessage(): void {}
  stop(): void {}

  async sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string> {
    if (this.sendTextFn) return this.sendTextFn(input);
    this.sent.push(input);
    return `msg-${this.nextMessageId++}`;
  }

  async patchText(input: { messageId: string; text: string }): Promise<void> {
    if (this.patchTextFn) return this.patchTextFn(input);
    this.patched.push(input);
  }
}

async function waitFor(condition: () => boolean, message: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function runTests(): Promise<void> {
  // Test 1: Full lifecycle — onStart → onTextDelta × N → onEnd
  {
    const transport = new MockTransport();
    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    await session.onStart();
    assert(transport.sent.length === 1, "onStart should send placeholder");
    assert(transport.sent[0].text.includes("思考中"), "placeholder should contain '思考中'");
    assert(transport.patched.length === 0, "no patches yet");

    session.onTextDelta("Hello");
    session.onTextDelta(" world");

    await waitFor(() => transport.patched.length >= 1, "debounce flush should fire");
    assert(transport.patched[0].text.includes("Hello world"), "patch should contain accumulated text");

    await session.onEnd();
    // onEnd does a final PATCH (may be 2nd or 3rd depending on debounce timing)
    assert(transport.patched.length >= 2, "onEnd should do final PATCH");
    const lastPatch = transport.patched[transport.patched.length - 1];
    assert(lastPatch.text.includes("Hello world"), "final patch should contain full text");
  }

  // Test 2: Debounce — rapid onTextDelta should batch into single flush
  {
    const transport = new MockTransport();
    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 100,
      maxLength: 4000,
    });

    await session.onStart();
    transport.patched.length = 0; // clear placeholder patch count

    session.onTextDelta("a");
    session.onTextDelta("b");
    session.onTextDelta("c");

    // Wait less than debounce interval — should not have flushed yet
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(transport.patched.length === 0, "should not flush before interval");

    // Wait for debounce to fire
    await waitFor(() => transport.patched.length >= 1, "debounce should fire after interval");
    assert(transport.patched.length === 1, "should batch into single flush");
    assert(transport.patched[0].text.includes("abc"), "batched flush should contain all deltas");
  }

  // Test 3: Race condition — onEnd before onStart completes
  {
    const transport = new MockTransport();
    let resolveSendText: ((value: string) => void) | null = null;

    // Make sendText hang until we resolve it
    transport.sendTextFn = () => new Promise<string>((resolve) => { resolveSendText = resolve; });

    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    // Start onStart but don't await it yet
    const startPromise = session.onStart();

    // onEnd arrives before onStart completes
    session.onTextDelta("some text");
    await session.onEnd("final content");

    // Now complete the sendText
    resolveSendText!("msg-1");
    await startPromise;

    // After onStart completes, it should have done a final PATCH with the pendingEndText
    assert(transport.patched.length >= 1, "should have done final PATCH after race resolution");
    const lastPatch = transport.patched[transport.patched.length - 1];
    assert(lastPatch.text.includes("final content"), "should use finalText from onEnd");
  }

  // Test 4: onStart failure should throw
  {
    const transport = new MockTransport();
    transport.sendTextFn = async () => { throw new Error("network error"); };

    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    let threw = false;
    try {
      await session.onStart();
    } catch (e) {
      threw = true;
      assert(e instanceof Error && e.message === "network error", "should propagate sendText error");
    }
    assert(threw, "onStart should throw on sendText failure");
  }

  // Test 5: dispose cancels pending timer
  {
    const transport = new MockTransport();
    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    await session.onStart();
    transport.patched.length = 0;

    session.onTextDelta("will be disposed");
    session.dispose();

    // Wait longer than debounce interval — timer should have been cancelled
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert(transport.patched.length === 0, "dispose should cancel pending flush timer");
  }

  // Test 6: onEnd with explicit finalText overrides buffer
  {
    const transport = new MockTransport();
    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    await session.onStart();
    session.onTextDelta("buffered text");
    await session.onEnd("explicit final text");

    const lastPatch = transport.patched[transport.patched.length - 1];
    assert(lastPatch.text.includes("explicit final text"), "explicit finalText should override buffer");
    assert(!lastPatch.text.includes("buffered text"), "buffer should not be used when finalText is provided");
  }

  // Test 7: double onEnd is idempotent
  {
    const transport = new MockTransport();
    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    await session.onStart();
    const patchCountBefore = transport.patched.length;
    await session.onEnd("final");
    const patchCountAfterFirst = transport.patched.length;
    await session.onEnd("final again");
    const patchCountAfterSecond = transport.patched.length;

    assert(patchCountAfterFirst > patchCountBefore, "first onEnd should PATCH");
    assert(patchCountAfterSecond === patchCountAfterFirst, "second onEnd should be idempotent");
  }

  // Test 8: PATCH failure degrades to sendText
  {
    const transport = new MockTransport();
    transport.patchTextFn = async () => { throw new Error("patch failed"); };

    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 4000,
    });

    await session.onStart();
    const sentBefore = transport.sent.length;
    await session.onEnd("some content");

    // PATCH failed → fallback to sendText
    assert(transport.sent.length > sentBefore, "should fallback to sendText on PATCH failure");
    const lastSent = transport.sent[transport.sent.length - 1];
    assert(lastSent.text.includes("some content"), "fallback sendText should contain content");
  }

  // Test 9: maxLength truncation
  {
    const transport = new MockTransport();
    const session = new FeishuStreamingSession("chat-1", "Agent", transport, {
      flushIntervalMs: 50,
      maxLength: 30, // very small
    });

    await session.onStart();
    session.onTextDelta("This is a very long text that should be truncated");
    await session.onEnd();

    const lastPatch = transport.patched[transport.patched.length - 1];
    // maxLength=30, prefix="[Agent] " (8 chars), maxBody=22, truncated body=22+"…"=23, total=31
    assert(lastPatch.text.length <= 31, `text should be truncated to maxLength+ellipsis, got ${lastPatch.text.length}`);
    assert(lastPatch.text.includes("\u2026"), "truncated text should end with ellipsis");
  }

  console.log("streaming-session tests passed");
}

runTests().catch((err) => { console.error(err); process.exit(1); });
