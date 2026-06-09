import { OpenAIMentionExtractor } from "../../src/llm/mention-extractor";
import type { MentionExtractionInput } from "../../src/llm/mention-extractor";
import { OpenAIClient } from "../../src/llm/openai";
import type { RoleName } from "../../src/persistence/store";

// Mock OpenAIClient for testing
class MockOpenAIClient extends OpenAIClient {
  constructor(private mockResponse: string) {
    super({ apiKey: "mock-key", model: "mock-model" });
  }

  async createChatCompletion(): Promise<string> {
    return this.mockResponse;
  }
}

function createTestInput(messageText: string, roleNames: RoleName[]): MentionExtractionInput {
  return {
    messageText,
    participatingRoles: roleNames.map((name) => ({ name })),
  };
}

// 测试：代码层面过滤不在候选列表中的名称（关键回归测试）
async function testFilterInvalidRoleNames(): Promise<void> {
  // 模拟 LLM 返回了不在候选列表中的名称
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [
        { role: "Owner Snail", raw: "@Owner Snail" },
        { role: "Unknown Snail", raw: "@Unknown Snail" }, // 不在候选列表中
        { role: "Another Unknown", raw: "@Another Unknown" }, // 不在候选列表中
      ],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("test message", ["Owner Snail", "Product Snail"]);
  const result = await extractor.extractMentions(input);

  // 应该只保留在候选列表中的 mention
  if (result.mentions.length !== 1) {
    throw new Error(`Expected 1 mention after filtering, got ${result.mentions.length}`);
  }
  if (result.mentions[0].role !== "Owner Snail") {
    throw new Error(`Expected "Owner Snail", got "${result.mentions[0].role}"`);
  }
  console.log("✓ testFilterInvalidRoleNames passed");
}

// 测试：过滤缺少必需字段的 mention
async function testFilterIncompleteMentions(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [
        { role: "Owner Snail", raw: "@Owner Snail" }, // 完整
        { role: "Product Snail" }, // 缺少 raw 字段
        { raw: "@Design Snail" }, // 缺少 role 字段
        { role: "", raw: "@Empty" }, // role 为空
        { role: "开发者", raw: "" }, // raw 为空
      ],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("test", ["Owner Snail", "Product Snail", "Design Snail", "开发者"]);
  const result = await extractor.extractMentions(input);

  // 应该只保留完整的 mention
  if (result.mentions.length !== 1) {
    throw new Error(`Expected 1 complete mention, got ${result.mentions.length}`);
  }
  if (result.mentions[0].role !== "Owner Snail") {
    throw new Error(`Expected "Owner Snail", got "${result.mentions[0].role}"`);
  }
  console.log("✓ testFilterIncompleteMentions passed");
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

// 测试：处理非数组的 mentions 字段
async function testHandleNonArrayMentions(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: "not an array",
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("test", ["Owner Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 0) {
    throw new Error(`Expected 0 mentions for non-array, got ${result.mentions.length}`);
  }
  console.log("✓ testHandleNonArrayMentions passed");
}

// 测试：处理空的 mentions 数组
async function testHandleEmptyMentions(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("test", ["Owner Snail"]);
  const result = await extractor.extractMentions(input);

  if (result.mentions.length !== 0) {
    throw new Error(`Expected 0 mentions, got ${result.mentions.length}`);
  }
  console.log("✓ testHandleEmptyMentions passed");
}

// 测试：同时验证多个过滤条件
async function testCombinedFiltering(): Promise<void> {
  const client = new MockOpenAIClient(
    JSON.stringify({
      mentions: [
        { role: "Owner Snail", raw: "@Owner Snail" }, // 有效
        { role: "Product Snail", raw: "@Product Snail" }, // 有效
        { role: "InvalidSnail", raw: "@Unknown" }, // 不在列表中
        { role: "Design Snail" }, // 缺少 raw
        { raw: "@Test" }, // 缺少 role
      ],
    })
  );
  const extractor = new OpenAIMentionExtractor(client);

  const input = createTestInput("test", ["Owner Snail", "Product Snail", "Design Snail"]);
  const result = await extractor.extractMentions(input);

  // 应该只保留两个有效的 mention
  if (result.mentions.length !== 2) {
    throw new Error(`Expected 2 valid mentions, got ${result.mentions.length}`);
  }
  if (result.mentions[0].role !== "Owner Snail" || result.mentions[1].role !== "Product Snail") {
    throw new Error(`Unexpected mention results: ${JSON.stringify(result.mentions)}`);
  }
  console.log("✓ testCombinedFiltering passed");
}

// 运行所有测试
async function runTests(): Promise<void> {
  console.log("Running mention-extractor parsing and filtering tests...\n");
  console.log("Note: These tests verify the extractor's parsing and filtering logic,");
  console.log("not the prompt's semantic effectiveness.\n");

  try {
    await testFilterInvalidRoleNames();
    await testFilterIncompleteMentions();
    await testHandleInvalidJSON();
    await testHandleNonArrayMentions();
    await testHandleEmptyMentions();
    await testCombinedFiltering();

    console.log("\n✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

runTests();
