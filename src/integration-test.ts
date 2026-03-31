import fs from "fs";
import path from "path";
import http from "http";
import { ConversationStore } from "./persistence/store";
import { Agent, AgentMessage, AgentReply } from "./agent/interface";
import { SessionManager } from "./session/manager";
import { createServer } from "./api/server";

class MockAgent implements Agent {
  readonly name = "mock";
  async chat(messages: AgentMessage[]): Promise<AgentReply> {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
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
    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode!, data });
        }
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

  const store = new ConversationStore(TEST_DB);
  const agent = new MockAgent();
  const sessionManager = new SessionManager(store, agent);

  const { server } = createServer(sessionManager);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as any).port;
      const base = `http://localhost:${port}/api`;

      (async () => {
        try {
          // 1. Create session
          const createRes = await req("POST", `${base}/sessions`, { title: "test chat" });
          console.log("Create session:", createRes.data);
          const sessionId = createRes.data.id;
          console.assert(createRes.status === 201, "should return 201");

          // 2. Send message
          const msgRes = await req("POST", `${base}/sessions/${sessionId}/messages`, {
            content: "你好 snail-shell！",
          });
          console.log("Agent reply:", msgRes.data);
          console.assert(msgRes.data.reply === "echo: 你好 snail-shell！", "mock agent should echo");

          // 3. Get history
          const historyRes = await req("GET", `${base}/sessions/${sessionId}/messages`);
          console.log("History:", historyRes.data);
          console.assert(historyRes.data.length === 2, "should have user + assistant messages");

          // 4. List sessions
          const listRes = await req("GET", `${base}/sessions`);
          console.log("Sessions:", listRes.data);
          console.assert(listRes.data.length === 1, "should have 1 session");

          // 5. Get session detail
          const detailRes = await req("GET", `${base}/sessions/${sessionId}`);
          console.log("Session detail:", detailRes.data);
          console.assert(detailRes.data.message_count === 2, "should have 2 messages");

          // 6. Delete session
          const delRes = await req("DELETE", `${base}/sessions/${sessionId}`);
          console.assert(delRes.status === 204, "should return 204");

          // 7. Confirm deleted
          const afterDel = await req("GET", `${base}/sessions`);
          console.assert(afterDel.data.length === 0, "should have 0 sessions");

          console.log("\nAll integration tests passed!");
        } catch (err) {
          console.error("Test error:", err);
          process.exit(1);
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
