---
id: F-01
title: 项目推进会话
type: frame
steps:
  - prompts: [B-01, B-02]
  - prompts: [B-03]
    when:
      runtimes: [claude-code-cli, claude-code-stateful-cli]
  - prompts: [S-01, S-02]
  - prompts: [S-03]
    when:
      stage_types: [development, review]
      snails: [Implementation Snail]
  - prompts: [S-04]
    when:
      stage_types: [review]
      snails: [Acceptance Snail]
---
