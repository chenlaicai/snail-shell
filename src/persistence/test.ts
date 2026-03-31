import { ConversationStore } from "./store";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(__dirname, "..", "data", "test-snail-shell.db");

// Clean up before test
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = new ConversationStore(TEST_DB);

// 1. Create session
const session = store.createSession("test-session-1", "Hello World");
console.log("Session created:", session);
console.assert(session.id === "test-session-1", "session id mismatch");
console.assert(session.title === "Hello World", "session title mismatch");

// 2. Add messages
store.addMessage("test-session-1", "user", "你好，snail shell！");
store.addMessage("test-session-1", "assistant", "你好！我是 Snail Shell，很高兴见到你。");
store.addMessage("test-session-1", "user", "请介绍一下你自己");

// 3. Get messages
const messages = store.getMessages("test-session-1");
console.log(`\nMessages (${messages.length}):`);
for (const msg of messages) {
  console.log(`  [${msg.role}] ${msg.content}`);
}
console.assert(messages.length === 3, "should have 3 messages");

// 4. Get session (updated_at should have changed)
const updatedSession = store.getSession("test-session-1");
console.log("\nUpdated session:", updatedSession);

// 5. Create another session, list all
store.createSession("test-session-2", "Second Session");
const sessions = store.listSessions();
console.log(`\nAll sessions (${sessions.length}):`);
for (const s of sessions) {
  console.log(`  ${s.id}: ${s.title} (updated: ${s.updated_at})`);
}
console.assert(sessions.length === 2, "should have 2 sessions");

// 6. Delete session
store.deleteSession("test-session-2");
const afterDelete = store.listSessions();
console.log(`\nAfter delete: ${afterDelete.length} session(s)`);
console.assert(afterDelete.length === 1, "should have 1 session after delete");

// Clean up
store.close();
fs.unlinkSync(TEST_DB);

console.log("\nAll tests passed!");
