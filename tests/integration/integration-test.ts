import fs from "fs";
import http from "http";
import path from "path";
import { Agent, AgentMessage, AgentReply } from "../../src/agent/interface";
import { createServer } from "../../src/api/server";
import { ConversationStore } from "../../src/persistence/store";
import { ProjectManager } from "../../src/project/manager";
import { SnailRegistry } from "../../src/snails";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class MockAgent implements Agent {
  readonly name = "mock";

  async chat(messages: AgentMessage[]): Promise<AgentReply> {
    const lastUserMsg = [...messages].reverse().find((message) => message.role === "user");
    return { content: `echo: ${lastUserMsg?.content ?? "hello"}` };
  }
}

const TEST_DB = path.join(__dirname, "..", "data", "test-integration.db");

function req(method: string, url: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
    };
    const request = http.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode!, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: response.statusCode!, data });
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function main() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

  const store = new ConversationStore(TEST_DB);
  const agent = new MockAgent();
  const snailRegistry = new SnailRegistry();
  const projectManager = new ProjectManager(store, agent, snailRegistry);
  const { server } = createServer(projectManager);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as any).port;
      const base = `http://localhost:${port}/api`;

      (async () => {
        try {
          const created = await req("POST", `${base}/projects`, {
            name: "Snail Shell",
            summary: "Self evolution project",
            kind: "system_self",
          });
          assert(created.status === 201, "project should be created");
          const projectId = created.data.project.id;
          const initialStageId = created.data.stage.id;
          const initialConversationId = created.data.conversation.id;

          const project = await req("GET", `${base}/projects/${projectId}`);
          assert(project.data.stage_count === 1, "project should start with one stage");

          const snails = await req("GET", `${base}/snails`);
          assert(Array.isArray(snails.data) && snails.data.length > 0, "snails should be available");

          const msgRes = await req("POST", `${base}/conversations/${initialConversationId}/messages`, {
            content: "hello shell",
          });
          assert(msgRes.data.reply === "echo: USER:\nhello shell", "conversation should work");

          const directedMsgRes = await req("POST", `${base}/conversations/${initialConversationId}/messages`, {
            content: "@Owner Snail hello owner",
          });
          assert(directedMsgRes.status === 200, "directed message should work");

          const invalidDirectedMsgRes = await req("POST", `${base}/conversations/${initialConversationId}/messages`, {
            content: "@Unknown Snail hello",
          });
          assert(invalidDirectedMsgRes.status === 200, "unknown snail should fall back to default snail");

          const historyRes = await req("GET", `${base}/conversations/${initialConversationId}/messages`);
          assert(historyRes.data[1].snail_name === "Owner Snail", "assistant message should store snail speaker");

          const stageConversation = await req("POST", `${base}/stages/${initialStageId}/conversations`, {
            project_id: projectId,
            title: "Requirements discussion",
            kind: "planning",
            from_conversation_ids: [initialConversationId],
          });
          assert(stageConversation.status === 201, "should create second conversation");
          assert(typeof stageConversation.data.default_snail === "string", "conversation should expose default snail");

          const artifactRes = await req("POST", `${base}/conversations/${initialConversationId}/artifacts`, {
            artifact_type: "project_charter",
            title: "Project Charter",
            storage_type: "inline_text",
            inline_content: "Snail Shell self project charter",
          });
          assert(artifactRes.status === 201, "artifact should be created");
          const artifactId = artifactRes.data.id;

          const discussionArtifactRes = await req("POST", `${base}/conversations/${initialConversationId}/artifacts`, {
            artifact_type: "initiative_discussion_record",
            title: "Initiative Discussion Record",
            storage_type: "inline_text",
            inline_content: "Initial discussion notes",
          });
          assert(discussionArtifactRes.status === 201, "discussion artifact should be created");
          const discussionArtifactId = discussionArtifactRes.data.id;

          const formalRes = await req("PUT", `${base}/stages/${initialStageId}/formal-artifacts`, {
            artifact_ids: [artifactId, discussionArtifactId],
          });
          assert(formalRes.data.formal_artifacts.length === 2, "formal artifacts should be saved");

          const nextStageRes = await req("POST", `${base}/projects/${projectId}/advance`, {});
          assert(nextStageRes.status === 201, "next stage should be created");
          assert(nextStageRes.data.conversation.stage_id === nextStageRes.data.next_stage.id, "next stage conversation should be created");

          const stageList = await req("GET", `${base}/projects/${projectId}/stages`);
          assert(stageList.data.length === 2, "project should now have two stage instances");

          console.log("\nAll integration tests passed!");
        } catch (err) {
          console.error("Test error:", err);
          process.exitCode = 1;
        } finally {
          server.close();
          store.close();
          if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
          resolve();
        }
      })();
    });
  });
}

main();
