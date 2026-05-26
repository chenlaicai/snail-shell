---
id: F2026051407
title: Snail Den 页面 runtime 显示与配置文件不一致
from_ids: []
tags: [ui, role, context]
modules: [project_management]
---
# F2026051407 Snail Den 页面 runtime 显示与配置文件不一致

## 背景

Snail Den 页面的 `formatRuntime` 函数将配置文件中的原始 runtime 标识符（如 `claude-code-cli`）映射为可读名称（如 `Claude Code`），导致页面显示与配置文件中不一致。用户明确要求页面直接显示配置原始值，不做映射。

## 目标

1. Snail Den 页面直接显示配置文件中的原始 runtime 值。
2. 移除 `formatRuntime` 映射函数。

## 非目标

1. 不修改数据层的 `normalizeRuntime`（`src/message-bus/message-protocol.ts`），该函数影响消息持久化，与本次 UI 显示修复无关。
2. 不修改 `.meta/snails.json` 或其他配置文件中的 runtime 值。

## 设计

移除 `snail-den-view.js` 中的 `formatRuntime` 函数，`renderSnailCard` 直接使用 `template.runtime` 原始值。此函数无其他调用方，删除后无副作用。

## 生效路径

1. `src/web/snail-den-view.js` - Snail Den 页面渲染逻辑

## 改动范围

1. `src/web/snail-den-view.js` - 移除 `formatRuntime` 函数，直接使用 `template.runtime`

## 验证

1. `npm run build` - 构建通过
2. `npm run lint` - 代码检查通过
3. Snail Den 页面显示的 runtime 与配置文件一致

## 风险与决策记录

无

## 范围变更记录

无
