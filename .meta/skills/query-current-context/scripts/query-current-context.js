#!/usr/bin/env node
"use strict";

// query-current-context skill — 查询当前 conversation 关联的完整运行时上下文。
// 不直接访问数据库；通过 db-bridge 获取原始数据，wrapper 负责 Markdown 格式化。

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function findBridge() {
  const sibling = path.join(__dirname, "..", "..", "..", "scripts", "db-bridge.js");
  if (fs.existsSync(sibling)) return sibling;
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".meta", "scripts", "db-bridge.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = __dirname;
  while (true) {
    const candidate = path.join(dir, ".meta", "scripts", "db-bridge.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return sibling;
}

const BRIDGE = findBridge();

function main() {
  const args = process.argv.slice(2);
  const getValue = (name) => { const i = args.indexOf(name); return (i >= 0 && i < args.length - 1) ? args[i + 1] : ""; };
  const conversationId = getValue("--conversation-id");
  if (!conversationId) { process.stderr.write("--conversation-id is required\n"); process.exit(1); }

  const data = JSON.parse(execFileSync(process.execPath, [BRIDGE, "--mode", "context-query", "--conversation-id", conversationId], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));

  process.stdout.write(format(data) + "\n");
}

// ── Format (matches original query-current-context output) ──

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

  if (project) {
    lines.push("## 项目");
    lines.push(`- 名称: ${project.name}`);
    if (project.summary) lines.push(`- 摘要: ${project.summary}`);
    lines.push("");
  }

  if (feature) {
    lines.push("## Feature");
    lines.push(`- 标题: ${feature.title}`);
    lines.push(`- ID: ${feature.id}`);
    if (feature.summary) lines.push(`- 摘要: ${feature.summary}`);
    if (feature.task_anchor) lines.push(`- 任务锚:\n${feature.task_anchor}`);
    lines.push("");
  }

  if (stage && stageDef) {
    const progress = getStageProgress(stage.type);
    const outputArtifacts = stage.output_artifacts || {};

    lines.push("## 当前 Stage");
    lines.push(`- 名称: ${stageDef.title}`);
    lines.push(`- 类型: ${stage.type}`);
    lines.push(`- 进度: ${progress.label}`);
    lines.push(`- 下一步动作: ${progress.nextAction}`);
    lines.push(`- Stage ID: ${stage.id}`);
    lines.push(`- Feature ID: ${stage.feature_id}`);
    if (stageDef.input_description) lines.push(`- Stage 输入: ${stageDef.input_description}`);
    if (stageDef.output_description) lines.push(`- Stage 交付要求: ${stageDef.output_description}`);

    const acceptanceFocus = stageDef.acceptance_focus || [];
    if (acceptanceFocus.length > 0) {
      lines.push("- 验收关注点:");
      acceptanceFocus.forEach((item) => lines.push(`  - ${item}`));
    }

    if (Object.keys(outputArtifacts).length > 0) {
      lines.push("- 当前输出产物:");
      Object.entries(outputArtifacts).forEach(([k, v]) => lines.push(`  - ${k}: ${v}`));
    }

    if (inputArtifacts && Object.keys(inputArtifacts).length > 0) {
      lines.push("- 上一 Stage 输入产物:");
      Object.entries(inputArtifacts).forEach(([k, v]) => lines.push(`  - ${k}: ${v}`));
    }
    lines.push("");
  }

  if (stage && stageRoles.length > 0) {
    const participatingRoles = conv.participating_roles || [];

    lines.push("## 角色");
    lines.push(`- 默认主角色: ${conv.default_role || "无"}`);

    if (participatingRoles.length > 0) {
      lines.push(`- 当前参与角色: ${participatingRoles.join("、")}`);
    }

    lines.push("- 角色详情:");
    stageRoles.forEach((roleDef) => {
      const workingRules = roleDef.working_rules || [];
      const isPrimary = roleDef.is_primary === 1;
      const marker = isPrimary ? " [主角色]" : "";
      lines.push(`  - ${roleDef.name}${marker}: ${roleDef.description}`);
      if (workingRules.length > 0) {
        workingRules.forEach((rule) => lines.push(`    - ${rule}`));
      }
    });
    lines.push("");
  }

  lines.push("## 当前 Conversation");
  lines.push(`- 标题: ${conv.title}`);
  lines.push(`- 类型: ${conv.kind}`);
  lines.push(`- 摘要: ${conv.summary ?? "无"}`);
  const sources = conv.from_conversation_ids || [];
  if (sources.length > 0) lines.push(`- 来源: ${sources.join(", ")}`);
  lines.push(`- Conversation ID: ${conv.id}`);

  return lines.join("\n");
}

try { main(); } catch (e) { process.stderr.write(e.stderr || e.message + "\n"); process.exit(e.status || 1); }
