# F2026051303 skill 目录结构与 message-out 命令重构

## 背景

Snail Shell 的 skill 目录结构存在以下问题：

1. `conversation-history` 和 `knowledge-candidate` 的脚本文件分散在 `.meta/scripts/` 目录，与各自的 `SKILL.md` 分离，不利于维护。
2. `message-out` 命令使用 `--payload` 参数传递 JSON，需要用户手动构造复杂的 JSON 结构，使用门槛高。
3. `snail-skill-creator` 缺少完整的使用说明，无法有效指导新 skill 的创建。

## 目标

1. 将 `conversation-history` 和 `knowledge-candidate` 脚本迁移到各自 skill 目录，实现 skill 的自包含。
2. 重构 `message-out` 命令，为每个子命令设计专属的命令行参数，去掉 `--payload`。
3. 充实 `snail-skill-creator`，添加完整的 SKILL.md 模板和使用说明。
4. 更新相关文档中的脚本路径引用。

## 非目标

1. 本次不修改 `message-out` 的核心业务逻辑（消息解析、格式化等）。
2. 本次不新增 skill 类型或命令。
3. 本次不修改 `.meta/scripts/` 中其他脚本。

## 设计

### 脚本迁移

将以下脚本从 `.meta/scripts/` 迁移到各自 skill 目录：

- `.meta/scripts/conversation-history` → `.meta/skills/conversation-history/conversation-history`
- `.meta/scripts/knowledge-candidate` → `.meta/skills/knowledge-candidate/knowledge-candidate`

迁移后，每个 skill 目录包含：
- `SKILL.md` - skill 说明和使用文档
- 可执行脚本 - skill 的实际执行入口

### message-out 参数设计

为每个子命令设计专属参数：

| 命令 | 参数 |
|------|------|
| text | `--text` `--mentions` |
| question | `--title` `--question` `--options` `--reason` |
| question-response | `--title` `--options` `--summary` `--selection-mode` |
| markdown | `--text` |
| table | `--title` `--columns` `--rows` |
| artifact-card | `--title` `--summary` `--artifact-id` `--artifact-type` |
| reference-card | `--title` `--ref-type` `--ref-id` `--summary` |

参数设计原则：
- 每个参数都有明确的语义和类型
- 必填参数缺失时给出清晰的错误提示
- 支持从 stdin 读取文本内容（`text` 和 `markdown` 命令）
- JSON 数组参数（`--options`、`--columns`、`--rows`）需要传入合法的 JSON 字符串

### snail-skill-creator 充实

添加以下内容：
- When To Use - 使用场景说明
- Instructions - 详细的创建步骤
- Output - 输出格式和位置说明
- SKILL.md 模板 - 标准的 skill 文档模板

## 生效路径

1. `.meta/skills/message-out/message-out` - message-out 可执行脚本
2. `.meta/skills/message-out/SKILL.md` - message-out 使用文档
3. `.meta/skills/conversation-history/conversation-history` - conversation-history 可执行脚本
4. `.meta/skills/conversation-history/SKILL.md` - conversation-history 使用文档
5. `.meta/skills/knowledge-candidate/knowledge-candidate` - knowledge-candidate 可执行脚本
6. `.meta/skills/knowledge-candidate/SKILL.md` - knowledge-candidate 使用文档
7. `.meta/skills/snail-skill-creator/SKILL.md` - skill 创建指南
8. `.meta/prompts/base/P0001-AI基础契约.md` - mention 场景示例

## 改动范围

1. `src/bin/message-out.ts` - 重构参数解析和 payload 构建逻辑
2. `.meta/skills/message-out/SKILL.md` - 更新使用文档
3. `.meta/skills/conversation-history/SKILL.md` - 更新脚本路径
4. `.meta/skills/conversation-history/conversation-history` - 新增可执行脚本
5. `.meta/skills/knowledge-candidate/SKILL.md` - 更新脚本路径
6. `.meta/skills/knowledge-candidate/knowledge-candidate` - 新增可执行脚本
7. `.meta/skills/snail-skill-creator/SKILL.md` - 充实使用说明
8. `.meta/prompts/base/P0001-AI基础契约.md` - 添加 mention 示例
9. `tests/project/message-out-test.ts` - 更新测试用例
10. `tests/scripts/knowledge-candidate-test.ts` - 更新脚本路径
11. `tests/meta/prompt-assets-test.ts` - 更新路径检查
12. `scripts/build-dist.ts` - 更新构建脚本

## 验证

1. `npm run build` - 构建通过
2. `npm test` - 所有 35 个测试文件通过
3. `message-out` 各子命令能正确解析参数并生成 payload
4. `conversation-history` 和 `knowledge-candidate` 脚本能正常执行
5. 错误参数能给出清晰的错误提示

## 风险与决策记录

1. 决策：使用 `parseNamedArgs` 统一解析命名参数，支持多值参数（如 `--mentions`）。原因是为了支持 `text` 命令的多 mention 场景，同时保持参数解析逻辑的一致性。
2. 决策：保留 `--payload` 参数的向后兼容性（当前实现已去掉）。原因是新参数设计更清晰，且 skill 使用文档会同步更新，不存在需要兼容的旧调用方。
3. 决策：脚本迁移后，`.meta/scripts/` 目录下的旧脚本暂不删除。原因是避免其他未记录的调用方出现问题，后续可通过全仓搜索确认后清理。
4. 决策：`buildQuestionResponsePayload` 中 `selectionMode` 默认为 `"single"`。原因是问题回答默认为单选，只有显式指定 `--selection-mode multiple` 时才为多选，这与用户交互的常见模式一致。

## 范围变更记录

1. 2026-05-13：根据 Acceptance Snail 检视意见，补充本 feature 文档。检视指出 PR 缺少 feature 文档，违反 Feature 文档治理规则。

## PR 记录

- PR #167: https://github.com/chenlaicai/snail-shell/pull/167
- 分支: feature/skill-reorganization
- 状态: 已提交，检视中
