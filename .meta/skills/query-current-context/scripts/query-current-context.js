#!/usr/bin/env node
"use strict";

// query-current-context — 查询当前 conversation 关联的 stage/feature/role/project 运行时上下文
//
// 用法:
//   node .meta/skills/query-current-context/scripts/query-current-context.js \
//     --db-path <path> --conversation-id <id>
//
// 输出: 格式化的文本上下文，供 AI 读取

const path = require("path");
const fs = require("fs");

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const getValue = (name) => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) return "";
    return argv[index + 1] ?? "";
  };

  const dbPath = getValue("--db-path") || process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  const conversationId = getValue("--conversation-id");

  if (!conversationId) {
    fail("--conversation-id is required");
  }

  return { dbPath, conversationId };
}

function fail(message) {
  process.stderr.write(`query-current-context: ${message}\n`);
  process.exit(1);
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function parseJsonArray(text) {
  const parsed = parseJson(text);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonRecord(text) {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

// ── Query ────────────────────────────────────────────────────────────────────

function query(db, args) {
  const { conversationId } = args;

  // 1. conversation
  const conv = db.prepare("SELECT * FROM conversation WHERE id = ?").get(conversationId);
  if (!conv) {
    fail(`Conversation not found: ${conversationId}`);
  }

  // 2. stage
  let stage = null;
  let stageDef = null;
  let stageRoles = [];
  let inputArtifacts = {};
  if (conv.stage_id) {
    stage = db.prepare("SELECT * FROM stage WHERE id = ?").get(conv.stage_id);
    if (stage) {
      stageDef = db.prepare("SELECT * FROM project_stage_definition WHERE id = ?").get(stage.stage_definition_id);
      stageRoles = db.prepare("SELECT * FROM stage_role_definition WHERE stage_definition_id = ?").all(stage.stage_definition_id);
      if (stage.sequence > 1) {
        const prevStage = db.prepare("SELECT * FROM stage WHERE feature_id = ? AND sequence = ?").get(stage.feature_id, stage.sequence - 1);
        if (prevStage) {
          inputArtifacts = parseJsonRecord(prevStage.output_artifacts);
        }
      }
    }
  }

  // 3. feature
  let feature = null;
  if (conv.feature_id) {
    feature = db.prepare("SELECT * FROM feature WHERE id = ?").get(conv.feature_id);
  }

  // 4. project
  let project = null;
  if (conv.project_id) {
    project = db.prepare("SELECT * FROM project WHERE id = ?").get(conv.project_id);
  }

  return { conv, stage, stageDef, stageRoles, feature, project, inputArtifacts };
}

// ── Format ───────────────────────────────────────────────────────────────────

function getStageProgress(stageType) {
  const map = {
    development: { label: "研发迭代 (第 1/2 阶段)", nextAction: "环境准备 (GATE-1~GATE-4)，详见 developer-handbook skill" },
    review: { label: "PR 检视 (第 2/2 阶段)", nextAction: "准备与上下文加载 (GATE-1~GATE-4)，详见 reviewer-handbook skill" },
  };
  return map[stageType] ?? { label: stageType, nextAction: "详见对应 skill" };
}

function format(data) {
  const { conv, stage, stageDef, stageRoles, feature, project, inputArtifacts } = data;
  const lines = [];

  // Project
  if (project) {
    lines.push("## 项目");
    lines.push(`- 名称: ${project.name}`);
    if (project.summary) lines.push(`- 摘要: ${project.summary}`);
    lines.push("");
  }

  // Feature
  if (feature) {
    lines.push("## Feature");
    lines.push(`- 标题: ${feature.title}`);
    lines.push(`- ID: ${feature.id}`);
    if (feature.summary) lines.push(`- 摘要: ${feature.summary}`);
    if (feature.task_anchor) lines.push(`- 任务锚:\n${feature.task_anchor}`);
    lines.push("");
  }

  // Stage
  if (stage && stageDef) {
    const progress = getStageProgress(stage.type);
    const outputArtifacts = parseJsonRecord(stage.output_artifacts);

    lines.push("## 当前 Stage");
    lines.push(`- 名称: ${stageDef.title}`);
    lines.push(`- 类型: ${stage.type}`);
    lines.push(`- 进度: ${progress.label}`);
    lines.push(`- 下一步动作: ${progress.nextAction}`);
    lines.push(`- Stage ID: ${stage.id}`);
    lines.push(`- Feature ID: ${stage.feature_id}`);
    if (stageDef.input_description) lines.push(`- Stage 输入: ${stageDef.input_description}`);
    if (stageDef.output_description) lines.push(`- Stage 交付要求: ${stageDef.output_description}`);

    const acceptanceFocus = parseJsonArray(stageDef.acceptance_focus);
    if (acceptanceFocus.length > 0) {
      lines.push("- 验收关注点:");
      acceptanceFocus.forEach((item) => lines.push(`  - ${item}`));
    }

    if (Object.keys(outputArtifacts).length > 0) {
      lines.push("- 当前输出产物:");
      Object.entries(outputArtifacts).forEach(([k, v]) => lines.push(`  - ${k}: ${v}`));
    }

    if (Object.keys(inputArtifacts).length > 0) {
      lines.push("- 上一 Stage 输入产物:");
      Object.entries(inputArtifacts).forEach(([k, v]) => lines.push(`  - ${k}: ${v}`));
    }
    lines.push("");
  }

  // Roles
  if (stage && stageRoles.length > 0) {
    const participatingRoles = parseJsonArray(conv.participating_roles);

    lines.push("## 角色");
    lines.push(`- 默认主角色: ${conv.default_role || "无"} (无显式 mention 时默认响应的角色，实际响应角色由系统提示词注入)`);

    if (participatingRoles.length > 0) {
      lines.push(`- 当前参与角色: ${participatingRoles.join("、")}`);
    }

    lines.push("- 角色详情:");
    stageRoles.forEach((roleDef) => {
      const workingRules = parseJsonArray(roleDef.working_rules);
      const isPrimary = roleDef.is_primary === 1;
      const marker = isPrimary ? " [主角色]" : "";
      lines.push(`  - ${roleDef.name}${marker}: ${roleDef.description}`);
      if (workingRules.length > 0) {
        workingRules.forEach((rule) => lines.push(`    - ${rule}`));
      }
    });
    lines.push("");
  }

  // Conversation
  lines.push("## 当前 Conversation");
  lines.push(`- 标题: ${conv.title}`);
  lines.push(`- 类型: ${conv.kind}`);
  lines.push(`- 摘要: ${conv.summary ?? "无"}`);
  const sources = parseJsonArray(conv.from_conversation_ids);
  if (sources.length > 0) lines.push(`- 来源: ${sources.join(", ")}`);
  lines.push(`- Conversation ID: ${conv.id}`);

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resolve and validate DB path
  const resolvedDbPath = path.resolve(args.dbPath);
  const dir = path.dirname(resolvedDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const Database = require("better-sqlite3");
  const db = new Database(resolvedDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const data = query(db, args);
    const output = format(data);
    process.stdout.write(output + "\n");
  } finally {
    db.close();
  }
}

main();
