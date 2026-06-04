import { WecomSdkTransport } from "../../src/interaction-entry/wecom/sdk-transport";
import type { IMInboundMessage } from "../../src/interaction-entry/im-channel/types";
import type { WecomConfig } from "../../src/persistence/wecom-config-store";
import crypto from "crypto";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createTestConfig(overrides: Partial<WecomConfig> = {}): WecomConfig {
  return {
    enabled: true,
    corp_id: "test_corp_id",
    corp_secret: "test_corp_secret",
    token: "test_token",
    encoding_aes_key: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG", // 43 chars valid base64
    allowed_chats: [{ chat_id: "wr_test_chat" }],
    message_push: { max_text_length: 4000 },
    ...overrides,
  };
}

/**
 * 用 AES-256-CBC 加密消息，模拟企业微信回调格式。
 * 格式：16 字节随机字符串 + 4 字节消息长度（大端）+ 消息内容 + CorpID
 */
function encryptForTest(msgContent: string, corpId: string, encodingAesKey: string): string {
  const aesKey = Buffer.from(encodingAesKey + "=", "base64");
  const iv = aesKey.subarray(0, 16);
  const randomBytes = crypto.randomBytes(16);
  const msgBuf = Buffer.from(msgContent, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const corpIdBuf = Buffer.from(corpId, "utf8");
  let plaintext = Buffer.concat([randomBytes, lenBuf, msgBuf, corpIdBuf]);
  // PKCS7 padding
  const padLen = 32 - (plaintext.length % 32);
  const padBuf = Buffer.alloc(padLen, padLen);
  plaintext = Buffer.concat([plaintext, padBuf]);
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
}

function buildWeChatXml(encrypted: string): string {
  return `<xml><ToUserName><![CDATA[wx_corp]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
}

async function runTests(): Promise<void> {
  // Test 1: AES decryption produces correct message
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);
    const received: IMInboundMessage[] = [];

    // prepare without app (skip route mounting for unit test)
    // Directly test the message parsing by calling onMessage and triggering handleMessage internals
    transport.onMessage((msg) => { received.push(msg); });

    // Build an encrypted message
    const xmlContent = `<xml>
      <ToUserName><![CDATA[wx_corp]]></ToUserName>
      <FromUserName><![CDATA[user1]]></FromUserName>
      <CreateTime>1234567890</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[Hello World]]></Content>
      <MsgId>12345</MsgId>
      <ChatId><![CDATA[wr_test_chat]]></ChatId>
      <CorpId><![CDATA[test_corp_id]]></CorpId>
    </xml>`;
    const encrypted = encryptForTest(xmlContent, config.corp_id, config.encoding_aes_key);
    const body = buildWeChatXml(encrypted);

    // Simulate the handleMessage flow by calling parseAndDecrypt indirectly
    // We need to test the parsing logic directly since we can't easily mock Express req/res
    const msg = (transport as any).parseAndDecrypt(body) as IMInboundMessage | null;
    assert(msg !== null, "parseAndDecrypt should return a message");
    assert(msg!.text === "Hello World", `text should be "Hello World", got "${msg!.text}"`);
    assert(msg!.chatId === "wr_test_chat", `chatId should be "wr_test_chat", got "${msg!.chatId}"`);
    assert(msg!.messageId === "12345", `messageId should be "12345", got "${msg!.messageId}"`);
    assert(msg!.tenantKey === "test_corp_id", `tenantKey should be "test_corp_id", got "${msg!.tenantKey}"`);

    transport.stop();
  }

  // Test 2: non-text messages are ignored
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);

    const xmlContent = `<xml>
      <ToUserName><![CDATA[wx_corp]]></ToUserName>
      <MsgType><![CDATA[image]]></MsgType>
      <Content><![CDATA[http://example.com/img.jpg]]></Content>
      <MsgId>12346</MsgId>
      <ChatId><![CDATA[wr_test_chat]]></ChatId>
      <CorpId><![CDATA[test_corp_id]]></CorpId>
    </xml>`;
    const encrypted = encryptForTest(xmlContent, config.corp_id, config.encoding_aes_key);
    const body = buildWeChatXml(encrypted);

    const msg = (transport as any).parseAndDecrypt(body) as IMInboundMessage | null;
    assert(msg === null, "non-text messages should be ignored");

    transport.stop();
  }

  // Test 3: message buffering — messages arrive before onMessage() are buffered
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);
    const received: IMInboundMessage[] = [];

    // Simulate a message arriving before onMessage() by pushing to pendingMessages
    const testMsg: IMInboundMessage = {
      tenantKey: "corp1",
      chatId: "wr_chat1",
      messageId: "msg1",
      text: "buffered message",
    };
    (transport as any).pendingMessages.push(testMsg);

    // Now register onMessage — should drain the buffer
    transport.onMessage((msg) => { received.push(msg); });

    assert(received.length === 1, `should have drained 1 buffered message, got ${received.length}`);
    assert(received[0].text === "buffered message", "buffered message should be delivered");

    // Verify buffer is cleared
    assert((transport as any).pendingMessages.length === 0, "pendingMessages should be empty after drain");

    transport.stop();
  }

  // Test 4: messages after onMessage() go directly to handler
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);
    const received: IMInboundMessage[] = [];

    transport.onMessage((msg) => { received.push(msg); });

    // Simulate a message arriving after onMessage() by calling the handler directly
    const testMsg: IMInboundMessage = {
      tenantKey: "corp1",
      chatId: "wr_chat1",
      messageId: "msg2",
      text: "direct message",
    };
    (transport as any).messageHandler(testMsg);

    assert(received.length === 1, `should have received 1 message, got ${received.length}`);
    assert(received[0].text === "direct message", "direct message should be delivered");

    transport.stop();
  }

  // Test 5: access_token caching
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);

    // Set a cached token that hasn't expired
    (transport as any).accessTokenCache = {
      token: "cached_token",
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    };

    const token = await (transport as any).getAccessToken();
    assert(token === "cached_token", `should return cached token, got "${token}"`);

    transport.stop();
  }

  // Test 6: access_token refresh when expired
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);

    // Set an expired token
    (transport as any).accessTokenCache = {
      token: "expired_token",
      expiresAt: Date.now() - 1000, // already expired
    };

    // Mock the refresh to avoid real HTTP call
    let refreshCalled = false;
    (transport as any).doRefreshAccessToken = async () => {
      refreshCalled = true;
      return "new_token";
    };

    const token = await (transport as any).getAccessToken();
    assert(refreshCalled, "should have called refresh");
    assert(token === "new_token", `should return new token, got "${token}"`);

    transport.stop();
  }

  // Test 7: concurrent token refresh shares the same promise
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);

    let refreshCount = 0;
    (transport as any).doRefreshAccessToken = async () => {
      refreshCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "shared_token";
    };

    // Fire 3 concurrent refreshes
    const [t1, t2, t3] = await Promise.all([
      (transport as any).refreshAccessToken(),
      (transport as any).refreshAccessToken(),
      (transport as any).refreshAccessToken(),
    ]);

    assert(refreshCount === 1, `doRefreshAccessToken should be called once, got ${refreshCount}`);
    assert(t1 === "shared_token" && t2 === "shared_token" && t3 === "shared_token", "all should get the same token");

    transport.stop();
  }

  // Test 8: callback URL verification — correct signature decrypts echostr
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);

    const echostr = "echostr_test_value";
    const encrypted = encryptForTest(echostr, config.corp_id, config.encoding_aes_key);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sorted = [config.token, timestamp, nonce, echostr].sort().join("");
    const signature = crypto.createHash("sha1").update(sorted).digest("hex");

    const decrypted = (transport as any).verifyAndDecryptEchostr(encrypted, timestamp, nonce, signature);
    assert(decrypted === echostr, `decrypted echostr should match, got "${decrypted}"`);

    transport.stop();
  }

  // Test 9: callback URL verification — wrong signature fails
  {
    const config = createTestConfig();
    const transport = new WecomSdkTransport(config);

    const echostr = "echostr_test_value";
    const encrypted = encryptForTest(echostr, config.corp_id, config.encoding_aes_key);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const wrongSignature = "wrong_signature";

    let threw = false;
    try {
      (transport as any).verifyAndDecryptEchostr(encrypted, timestamp, nonce, wrongSignature);
    } catch {
      threw = true;
    }
    assert(threw, "wrong signature should throw an error");

    transport.stop();
  }

  console.log("wecom-transport tests passed");
}

runTests().catch((err) => { console.error(err); process.exit(1); });
