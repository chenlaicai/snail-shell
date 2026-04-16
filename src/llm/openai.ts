export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class OpenAIClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async createChatCompletion(messages: OpenAIChatMessage[]): Promise<string> {
    const response = await this.performChatCompletionRequest(messages);
    return this.extractChatCompletionContent(response);
  }

  private async performChatCompletionRequest(messages: OpenAIChatMessage[]): Promise<Response> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages,
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenAI request timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async extractChatCompletionContent(response: Response): Promise<string> {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
        delta?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
        text?: string;
      }>;
      output_text?: string;
    };

    const content = extractChoiceContent(data);
    if (content) {
      return content;
    }

    throw new Error("OpenAI response did not include assistant content");
  }
}

function extractChoiceContent(data: {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    text?: string;
  }>;
  output_text?: string;
}): string | null {
  // We intentionally support a small set of OpenAI-compatible response shapes here.
  // The summary client calls `/chat/completions`, but in practice some compatible
  // gateways bridge different backend protocol families into that surface. Rather
  // than accepting arbitrary fields, we only recognize these known text locations:
  // 1. `choices[0].message.content`: standard chat-completions response
  // 2. `choices[0].delta.content`: gateways that expose delta-shaped content even in
  //    non-streaming responses
  // 3. `choices[0].text`: legacy completion-style fallback
  // 4. `output_text`: flattened text returned by some newer compatibility layers
  //
  // The order matters: we prefer the field that is closest to the canonical chat
  // completion protocol and only fall back to looser compatibility shapes when the
  // canonical one is absent.
  const choice = data.choices?.[0];
  return (
    extractTextContent(choice?.message?.content)
    ?? extractTextContent(choice?.delta?.content)
    ?? normalizeText(choice?.text)
    ?? normalizeText(data.output_text)
  );
}

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined): string | null {
  // `message.content` and `delta.content` may be either a plain string or an array of
  // text-like blocks. We only extract textual data here; if a backend returns a shape
  // outside these documented compatibility forms, the caller should fail fast.
  if (typeof content === "string") {
    return normalizeText(content);
  }

  if (Array.isArray(content)) {
    return normalizeText(content.map((item) => item?.text || "").join(""));
  }

  return null;
}

function normalizeText(content: string | undefined): string | null {
  const normalized = content?.trim();
  return normalized ? normalized : null;
}
