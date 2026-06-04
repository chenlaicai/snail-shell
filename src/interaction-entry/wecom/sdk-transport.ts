import crypto from "crypto";
import { logger } from "../../logger";
import type { IMInboundMessage, IMTransport, IMTransportContext } from "../im-channel/types";
import type { WecomConfig } from "../../persistence/wecom-config-store";

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

interface DecryptedPayload {
  msgLen: number;
  content: string;
}

/**
 * 企业微信 Transport 实现。
 *
 * 通过 HTTP 回调接收消息（非 WebSocket），在 prepare() 中挂载路由到 Express app，
 * 在 onMessage() 中注册消息回调。prepare() 到 onMessage() 之间的消息通过
 * pendingMessages 队列缓冲，确保不丢失。
 */
export class WecomSdkTransport implements IMTransport {
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;
  private pendingMessages: IMInboundMessage[] = [];
  private accessTokenCache: AccessTokenCache | null = null;
  private refreshPromise: Promise<string> | null = null;
  private readonly baseUrl = "https://qyapi.weixin.qq.com";
  private readonly aesKey: Buffer;
  private readonly iv: Buffer;

  constructor(private readonly config: WecomConfig) {
    this.aesKey = Buffer.from(config.encoding_aes_key + "=", "base64");
    this.iv = this.aesKey.subarray(0, 16);
  }

  async prepare(ctx: IMTransportContext): Promise<void> {
    if (!ctx.app) throw new Error("WecomSdkTransport requires Express app");
    ctx.app.get("/webhook/wecom", this.handleVerification.bind(this));
    ctx.app.post("/webhook/wecom", this.handleMessage.bind(this));
    await this.refreshAccessToken();
  }

  onMessage(handler: (message: IMInboundMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
    for (const msg of this.pendingMessages) {
      try {
        handler(msg);
      } catch (error) {
        logger.error("WeCom pending message drain failed", { messageId: msg.messageId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    this.pendingMessages = [];
  }

  stop(): void {
    this.messageHandler = null;
    this.pendingMessages = [];
    this.accessTokenCache = null;
    this.refreshPromise = null;
  }

  async sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/appchat/send?access_token=${token}`;
    const body = JSON.stringify({
      chatid: input.chatId,
      msgtype: "text",
      text: { content: input.text },
    });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const result = await response.json() as { errcode: number; errmsg: string };
    if (result.errcode !== 0) {
      throw new Error(`WeCom sendText failed: errcode=${result.errcode} errmsg=${result.errmsg}`);
    }
    // 企业微信群聊 API 不返回 message_id，返回空字符串
    return "";
  }

  // --- 回调 URL 验证 ---

  private handleVerification(req: { query: Record<string, string | undefined> }, res: { send(body: string): void }): void {
    try {
      const { msg_signature, timestamp, nonce, echostr } = req.query;
      if (!msg_signature || !timestamp || !nonce || !echostr) {
        res.send("");
        return;
      }
      const decrypted = this.verifyAndDecryptEchostr(echostr, timestamp, nonce, msg_signature);
      res.send(decrypted);
    } catch (error) {
      logger.error("WeCom URL verification failed", { error: error instanceof Error ? error.message : String(error) });
      res.send("");
    }
  }

  private verifyAndDecryptEchostr(encryptedEchostr: string, timestamp: string, nonce: string, signature: string): string {
    const { content } = this.decryptPayload(encryptedEchostr);
    const echostr = content;
    // 验证签名
    const sorted = [this.config.token, timestamp, nonce, echostr].sort().join("");
    const expectedSignature = crypto.createHash("sha1").update(sorted).digest("hex");
    if (expectedSignature !== signature) {
      throw new Error("Signature verification failed");
    }
    return echostr;
  }

  // --- 消息回调 ---

  private handleMessage(req: { on(event: string, listener: (chunk: Buffer) => void): void }, res: { end(body: string): void }): void {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        const msg = this.parseAndDecrypt(body);
        if (msg) {
          if (this.messageHandler) {
            this.messageHandler(msg);
          } else {
            this.pendingMessages.push(msg);
          }
        }
      } catch (error) {
        logger.error("WeCom message processing failed", { error: error instanceof Error ? error.message : String(error) });
      }
      res.end('{"errcode":0,"errmsg":"ok"}');
    });
  }

  private parseAndDecrypt(body: string): IMInboundMessage | null {
    const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    if (!encryptMatch?.[1]) return null;

    const { content } = this.decryptPayload(encryptMatch[1]);
    const msgType = this.extractXmlField(content, "MsgType");
    if (msgType !== "text") return null;

    const msgContent = this.extractXmlField(content, "Content");
    const chatId = this.extractXmlField(content, "ChatId");
    const msgId = this.extractXmlField(content, "MsgId");
    const corpId = this.extractXmlField(content, "CorpId") || this.extractXmlField(content, "ToUserName");

    if (!msgContent || !chatId || !msgId) return null;

    return {
      tenantKey: corpId || null,
      chatId,
      messageId: msgId,
      text: msgContent,
    };
  }

  /**
   * 共享解密逻辑：AES-256-CBC 解密 + PKCS7 去填充 + 消息内容提取。
   * 格式：16 字节随机字符串 + 4 字节消息长度（大端）+ 消息内容 + CorpID
   */
  private decryptPayload(encrypted: string): DecryptedPayload {
    const decipher = crypto.createDecipheriv("aes-256-cbc", this.aesKey, this.iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);
    // 去除 PKCS7 padding
    const pad = decrypted[decrypted.length - 1];
    if (pad >= 1 && pad <= 32) {
      decrypted = decrypted.subarray(0, decrypted.length - pad);
    }
    const msgLen = decrypted.readUInt32BE(16);
    return { msgLen, content: decrypted.subarray(20, 20 + msgLen).toString("utf8") };
  }

  private extractXmlField(xml: string, field: string): string | null {
    // CDATA 格式：<Field><![CDATA[value]]></Field>
    const cdataMatch = xml.match(new RegExp(`<${field}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${field}>`));
    if (cdataMatch?.[1]) return cdataMatch[1];
    // 纯文本格式：<Field>value</Field>
    const plainMatch = xml.match(new RegExp(`<${field}>([\\s\\S]*?)<\\/${field}>`));
    return plainMatch?.[1] ?? null;
  }

  // --- access_token 管理 ---

  private async getAccessToken(): Promise<string> {
    if (this.accessTokenCache && Date.now() < this.accessTokenCache.expiresAt) {
      return this.accessTokenCache.token;
    }
    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshAccessToken(): Promise<string> {
    const url = `${this.baseUrl}/cgi-bin/gettoken?corpid=${this.config.corp_id}&corpsecret=${this.config.corp_secret}`;
    const response = await fetch(url);
    const result = await response.json() as { errcode: number; errmsg: string; access_token?: string; expires_in?: number };
    if (result.errcode !== 0 || !result.access_token) {
      throw new Error(`Failed to get access_token: ${result.errcode} ${result.errmsg}`);
    }
    this.accessTokenCache = {
      token: result.access_token,
      expiresAt: Date.now() + ((result.expires_in ?? 7200) - 300) * 1000,
    };
    return result.access_token;
  }
}
