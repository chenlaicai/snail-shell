import { OpenAIMentionExtractor } from "../../src/llm/mention-extractor";
import type { MentionExtractionInput } from "../../src/llm/mention-extractor";
import type { OpenAIClient } from "../../src/llm/openai";
import type { SnailName } from "../../src/persistence/store";

// Mock OpenAIClient for testing
class MockOpenAIClient implements OpenAIClient {
  constructor(private mockResponse: string) {}

  async createChatCompletion(): Promise<string> {
    return this.mockResponse;
  }
}

function createTestInput(messageText: string, snailNames: SnailName[]): MentionExtractionInput {
  return {
    messageText,
    participatingSnails: snailNames.map((name) => ({ name })),
  };
}

// 测试：正确识别 @ 符号呼叫
async function testAtMention(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [{ snail: "Owner Snail", raw: "@Owner Snail" }],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("@Owner Snail 请确认一下", ["Owner Snail", "Product Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 1) {
    throw new Error(`Expected 1 mention, got ${result.mentions.length}`);
  }
  if (result.mentions[0].snail !== "Owner Snail") {
    throw new Error(`Expected "Owner Snail", got "${result.mentions[0].snail}"`);
  }
  console.log("✓ testAtMention passed");
}

// 测试：正确识别请求参与
async function testRequestParticipation(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [{ snail: "Design Snail", raw: "请 Design Snail 看看" }],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("请 Design Snail 看看这个设计", ["Owner Snail", "Design Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 1) {
    throw new Error(`Expected 1 mention, got ${result.mentions.length}`);
  }
  if (result.mentions[0].snail !== "Design Snail") {
    throw new Error(`Expected "Design Snail", got "${result.mentions[0].snail}"`);
  }
  console.log("✓ testRequestParticipation passed");
}

// 测试：不识别自我介绍
async function testIgnoreSelfIntroduction(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("我是 Owner Snail", ["Owner Snail", "Product Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 0) {
    throw new Error(`Expected 0 mentions, got ${result.mentions.length}`);
  }
  console.log("✓ testIgnoreSelfIntroduction passed");
}

// 测试：不识别陈述事实
async function testIgnoreFactStatement(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("Owner Snail 负责项目管理", ["Owner Snail", "Product Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 0) {
    throw new Error(`Expected 0 mentions, got ${result.mentions.length}`);
  }
  console.log("✓ testIgnoreFactStatement passed");
}

// 测试：不识别历史回顾
async function testIgnoreHistoricalReference(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("之前 Design Snail 说过这个问题", ["Owner Snail", "Design Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 0) {
    throw new Error(`Expected 0 mentions, got ${result.mentions.length}`);
  }
  console.log("✓ testIgnoreHistoricalReference passed");
}

// 测试：代码层面过滤不在候选列表中的名称（关键回归测试）
async function testFilterInvalidSnailNames(): Promise<void> {
  // 模拟 LLM 返回了不在候选列表中的名称
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [
        { snail: "Owner Snail", raw: "@Owner Snail" },
        { snail: "Unknown Snail", raw: "@Unknown Snail" }, // 不在候选列表中
      ],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("@Owner Snail @Unknown Snail", ["Owner Snail", "Product Snail"]);
  const result = await extractor.extractMentions(input);

  // 应该只保留在候选列表中的 mention
  if (result.mentions.length !== 1) {
    throw new Error(`Expected 1 mention after filtering, got ${result.mentions.length}`);
  }
  if (result.mentions[0].snail !== "Owner Snail") {
    throw new Error(`Expected "Owner Snail", got "${result.mentions[0].snail}"`);
  }
  console.log("✓ testFilterInvalidSnailNames passed");
}

// 测试：处理 JSON 解析错误
async function testHandleInvalidJSON(): Promise<void> {
  const client = new MockOpenAIClient("invalid json");
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("@Owner Snail", ["Owner Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 0) {
    throw new Error(`Expected 0 mentions on parse error, got ${result.mentions.length}`);
  }
  console.log("✓ testHandleInvalidJSON passed");
}

// 测试：过滤缺少必需字段的 mention
async function testFilterIncompleteMentions(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [
        { snail: "Owner Snail", raw: "@Owner Snail" },
        { snail: "Product Snail" }, // 缺少 raw 字段
        { raw: "@Design Snail" }, // 缺少 snail 字段
      ],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("test", ["Owner Snail", "Product Snail", "Design Snail"]);
  const result = await extractor.extractMentions(input);

  // 应该只保留完整的 mention
  if (result.mentions.length !== 1) {
    throw new Error(`Expected 1 complete mention, got ${result.mentions.length}`);
  }
  if (result.mentions[0].snail !== "Owner Snail") {
    throw new Error(`Expected "Owner Snail", got "${result.mentions[0].snail}"`);
  }
  console.log("✓ testFilterIncompleteMentions passed");
}

// 运行所有测试
async function runTests(): Promise<void> {
  console.log("Running mention-extractor tests...\n");

  try {
    await testAtMention();
    await testRequestParticipation();
    await testIgnoreSelfIntroduction();
    await testIgnoreFactStatement();
    await testIgnoreHistoricalReference();
    await testFilterInvalidSnailNames();
    await testHandleInvalidJSON();
    await testFilterIncompleteMentions();

    console.log("\n✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

runTests();
