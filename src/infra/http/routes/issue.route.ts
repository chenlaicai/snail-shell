import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { decodeWorkspaceId, encodeWorkspaceId, toWorkspaceDto } from "@infra/http/workspace-id";
import { getLogger } from "@infra/logger";
import type { WorkspaceAdapter } from "@domain/workspace/_internal/adapter";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import type { Issue, Stage } from "@domain/issue/model";
import type { Message } from "@domain/message/model";

const log = getLogger({ module: "http" });

interface IssueRoutesDeps {
  workspaceAdapter: WorkspaceAdapter;
  issuePort: IssuePort;
  stagePort: StagePort;
  messagePort: MessagePort;
  collaboration: CollaborationInput;
}

const snailAssignmentPlanSchema = z.record(z.string(), z.record(z.string(), z.string()));

const createIssueBody = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  adopted_sop_key: z.string().min(1),
  snail_assignment_plan: snailAssignmentPlanSchema,
});

const sendMessageBody = z.object({
  text: z.string().min(1),
  from_speaker: z.string().optional(),
  to_speakers: z.array(z.string()).optional(),
});

const advanceStageBody = z.object({
  target_key: z.string().min(1),
});

export function createIssueRoutes(deps: IssueRoutesDeps) {
  const app = new Hono();

  app.get("/api/workspaces/:workspaceId", (c) => {
    const workspacePath = decodeWorkspaceId(c.req.param("workspaceId"));
    const workspace = deps.workspaceAdapter.list().find(item => item.path === workspacePath);
    if (!workspace) return c.json(null, 404);
    const issues = deps.issuePort.listIssues(workspace.path);
    return c.json({ ...toWorkspaceDto(workspace), issues: issues.map(issue => toIssueDetail(deps, issue)) });
  });

  app.get("/api/workspaces/:workspaceId/issues", (c) => {
    const workspacePath = decodeWorkspaceId(c.req.param("workspaceId"));
    const issues = deps.issuePort.listIssues(workspacePath);
    return c.json(issues.map(issue => toIssueDetail(deps, issue)));
  });

  app.get("/api/sops/:sopKey/stage-previews", (c) => {
    return c.json(deps.issuePort.previewSopStages(c.req.param("sopKey"), c.req.query("title") ?? ""));
  });

  app.post("/api/workspaces/:workspaceId/issues", zValidator("json", createIssueBody), async (c) => createIssue(c, deps));

  app.get("/api/issues/:issueId", (c) => {
    const issue = deps.issuePort.findIssue(c.req.param("issueId"));
    if (!issue) return c.json(null, 404);
    return c.json(toIssueDetail(deps, issue));
  });

  app.get("/api/issues/:issueId/stages", (c) => {
    return c.json(deps.stagePort.listStages(c.req.param("issueId")).map(stage => toStageDto(deps, stage)));
  });

  app.get("/api/stages/:stageId", (c) => {
    const stage = deps.stagePort.findStage(c.req.param("stageId"));
    if (!stage) return c.json(null, 404);
    return c.json(toStageDto(deps, stage));
  });

  app.get("/api/stages/:stageId/messages", (c) => listMessages(c, deps));

  app.post("/api/stages/:stageId/messages", zValidator("json", sendMessageBody), async (c) => sendMessage(c, deps));

  app.post("/api/stages/:stageId/messages/:messageId/interrupt", (c) => interruptMessage(c, deps));

  app.get("/api/stages/:stageId/transition-suggestions", (c) => {
    return c.json(deps.collaboration.listStageTransitionSuggestions(c.req.param("stageId")));
  });

  app.delete("/api/stages/:stageId/transition-suggestions/:targetKey", (c) => {
    const stageId = c.req.param("stageId");
    const targetKey = c.req.param("targetKey");
    const createdAt = c.req.query("created_at");
    if (!createdAt) return c.json({ error: "created_at query param required" }, 400);
    const dismissed = deps.collaboration.dismissSuggestion(stageId, targetKey, createdAt);
    if (!dismissed) return c.json({ error: "Suggestion not found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/stages/:stageId/advance", zValidator("json", advanceStageBody), async (c) => {
    const stageId = c.req.param("stageId");
    const body = c.req.valid("json");
    /** L2: 手动推进前引擎评估，blocked 时拒绝推进 */
    const evaluation = await deps.collaboration.evaluateAdvance(stageId);
    if (evaluation.action === "blocked") {
      return c.json({ error: "Advance blocked by engine", evaluation }, 409);
    }
    const stage = await deps.collaboration.advanceStage(stageId, body.target_key);
    return c.json(toStageDto(deps, stage), 201);
  });

  app.post("/api/issues/:issueId/close", (c) => closeIssue(c, deps));

  return app;
}


function listMessages(c: Context, deps: IssueRoutesDeps) {
  const stageId = requiredParam(c, "stageId");
  const limit = numberQuery(c.req.query("limit"));
  const beforeId = numberQuery(c.req.query("before_id"));
  return c.json(deps.messagePort.listMessages(stageId, limit, beforeId).map(message => toMessageDto(deps, message)));
}

async function createIssue(c: Context, deps: IssueRoutesDeps) {
  const body = createIssueBody.parse(await c.req.json());
  try {
    const result = await deps.collaboration.createIssue({
      workspace_path: decodeWorkspaceId(requiredParam(c, "workspaceId")),
      title: body.title,
      summary: body.summary,
      adopted_sop_key: body.adopted_sop_key,
      snail_assignment_plan: body.snail_assignment_plan,
    });
    return c.json({ issue: toIssueDetail(deps, result.issue), stage: toStageDto(deps, result.stage) }, 201);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith("SOP not found:")) {
        return c.json({ error: error.message }, 400);
      }
      if (error.message.includes("snail assignment") || error.message.includes("stage definitions")) {
        return c.json({ error: error.message }, 400);
      }
    }
    throw error;
  }
}

async function sendMessage(c: Context, deps: IssueRoutesDeps) {
  const stageId = requiredParam(c, "stageId");
  const body = sendMessageBody.parse(await c.req.json());
  try {
    await deps.collaboration.sendMessage(stageId, body.text, body.from_speaker, body.to_speakers);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Issue is closed:")) {
      log.warn({ stageId, error: error.message }, "issue.send.blocked");
      return c.json({ error: "Issue is closed" }, 409);
    }
    throw error;
  }
  return c.json({ ok: true });
}

async function interruptMessage(c: Context, deps: IssueRoutesDeps) {
  const messageId = Number(c.req.param("messageId"));
  if (!Number.isFinite(messageId)) return c.json({ error: "Invalid messageId" }, 400);
  const message = deps.messagePort.getMessage(messageId);
  if (!message) return c.json({ error: "Message not found" }, 404);
  if (message.status !== "streaming") return c.json({ interrupted: false, error: "Message is not streaming" }, 409);
  const interrupted = await deps.collaboration.interruptMessage(messageId);
  return c.json({ interrupted });
}

function toIssueDetail(deps: Pick<IssueRoutesDeps, "stagePort" | "collaboration">, issue: Issue) {
  const stages = deps.stagePort.listStages(issue.id).map(stage => toStageDto(deps, stage, issue));
  const currentStage = stages.find(stage => !stage.left_at) ?? stages.at(-1);
  if (!currentStage) throw new Error(`Issue has no current stage: ${issue.id}`);

  const activityStatus = deps.collaboration.getActivityStatus(currentStage.id, issue.closed_at);

  return {
    ...issue,
    workspace_id: encodeWorkspaceId(issue.workspace_path),
    close_summary: issue.close_summary,
    stages,
    current_stage: currentStage,
    activity_status: activityStatus,
  };
}

function toStageDto(deps: Pick<IssueRoutesDeps, "stagePort">, stage: Stage, issue?: Issue) {
  const stageDef = issue?.sop_snapshot.stage_definitions.find(sd => sd.key === stage.key);
  return {
    ...stage,
    type: stage.key,
    created_at: stage.entered_at,
    active_roles: stage.role_instances,
    assignments: deps.stagePort.getRoleSnailAssignments(stage.id),
    status: stage.left_at ? "completed" : "in_progress",
    stage_definition: stageDef ? { title: stageDef.title, roles: stageDef.roles } : undefined,
  };
}

function toMessageDto(deps: Pick<IssueRoutesDeps, "messagePort">, message: Message) {
  const role = message.from_speaker === "user" ? "user" : message.from_speaker ? "assistant" : "system";
  return {
    ...message,
    conversation_id: message.stage_id,
    from_role: message.from_speaker,
    to_roles: message.to_speakers,
    role,
    updated_at: message.ended_at ?? message.created_at,
    context: deps.messagePort.getContext(message.id),
    events: deps.messagePort.getMessageEvents(message.id),
  };
}

function requiredParam(c: Context, key: string): string {
  const value = c.req.param(key);
  if (!value) throw new Error(`Missing route param: ${key}`);
  return value;
}

function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function closeIssue(c: Context, deps: IssueRoutesDeps) {
  const issueId = requiredParam(c, "issueId");
  try {
    const { issue, cleanup } = await deps.collaboration.closeIssue(issueId);
    return c.json({ issue: toIssueDetail(deps, issue), cleanup });
  } catch (error) {
    if (error instanceof Error && error.message === `Issue not found: ${issueId}`) {
      return c.json({ error: "Issue not found" }, 404);
    }
    throw error;
  }
}
