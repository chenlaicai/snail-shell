import { MessageInterruptRegistry } from "../../src/message-bus/message-interrupt";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const registry = new MessageInterruptRegistry();
const projectController = registry.createRunController();
const governanceController = registry.createRunController();

registry.bindMessage("project-conversation", 1, projectController);
registry.bindMessage("knowledge-governance-conversation", 1, governanceController);

assert(registry.interrupt("knowledge-governance-conversation", 1) === true, "governance message should be interruptible by its scoped key");
assert(governanceController.signal.aborted, "governance controller should be aborted");
assert(!projectController.signal.aborted, "project controller with the same local message id must not be aborted");
assert(registry.interrupt("knowledge-governance-conversation", 1) === false, "already aborted message should not report a second interrupt");

registry.finishMessage("project-conversation", 1);
assert(registry.interrupt("project-conversation", 1) === false, "finished message should no longer be interruptible");

console.log("message-interrupt tests passed");
