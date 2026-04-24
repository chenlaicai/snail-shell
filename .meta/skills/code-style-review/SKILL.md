---
name: code-style-review
description: TypeScript 代码规范与可维护性检视。用于用户要求代码规范 review、结构性 review、无语义重构建议或建立质量门禁时。
---

# Code Style Review

## Purpose

这个 skill 用于在 TypeScript 代码检视中优先识别可维护性退化问题。

## Rules

1. 优先看可维护性和结构问题，再看纯格式问题。
2. 重点关注文件、类、方法过长，以及职责混杂、重复逻辑、类型边界不清。
3. 重构建议必须以“不改变业务语义”为前提。
4. 结论必须具体到文件和代码段。
5. 如果仓库已接入 ESLint，则必须执行 `npm run lint` 并把结果纳入结论。
