# Runtime CLI Response Baselines

## 文档定位

本文件只记录一类内容：各个 agent CLI 的真实调用参数与真实响应数据。

它的职责比消息模型文档更底层，也更稳定：

1. 它记录 runtime 事实上发出了什么。
2. 它区分本轮实机采样与仓库内已有 fixture。
3. 后续不管消息模型怎么重构，都必须能解释这里的 runtime 事实。

换句话说：

- 消息模型可以变
- 渲染方式可以变
- 持久化结构可以变
- 但 runtime 真实响应事实不能被改写

## 证据等级

本文件中的样本分为三种证据等级：

1. `captured-success`
   本轮在当前仓库中实际调用 CLI，成功完成。
2. `captured-failure`
   本轮在当前仓库中实际调用 CLI，但在成功完成前失败。
3. `repo-fixture`
   仓库测试或 adapter 注释中已经编码的 payload 形状，但不是本轮实机成功采样。

## 全局说明

1. 同一自然语言 prompt，在不同 CLI 参数下可能产生不同低层事件序列。
2. session / continue / attach / desktop 环境变量会直接影响响应结构。
3. 是否存在原生 final result，是 runtime 能力问题，不是上层消息模型可以强行假设的事实。
4. Gemini 当前在本机不可用，因此本轮只记录失败事实，不把它纳入本轮新消息模型的约束中心。

---

## Claude Code CLI

### Capture A

- Evidence: `captured-success`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
claude -p --no-session-persistence --output-format stream-json --verbose --permission-mode bypassPermissions "In the current repository, first run a shell command to print the current directory, then run a shell command to read the package name from package.json, then answer with one short sentence containing only the package name."
```

- Observed output:

```json
{"type":"system","subtype":"init","cwd":"/Users/orca/ai/snail-shell","session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","tools":["Task","AskUserQuestion","Bash","CronCreate","CronDelete","CronList","Edit","EnterPlanMode","EnterWorktree","ExitPlanMode","ExitWorktree","Glob","Grep","NotebookEdit","Read","Skill","TaskOutput","TaskStop","TodoWrite","WebFetch","WebSearch","Write"],"mcp_servers":[],"model":"gpt-5.4","permissionMode":"bypassPermissions","slash_commands":["update-config","debug","simplify","batch","loop","claude-api","agent-browser","pdf","compact","context","cost","heapdump","init","pr-comments","release-notes","review","security-review","insights"],"apiKeySource":"none","claude_code_version":"2.1.87","output_style":"default","agents":["general-purpose","statusline-setup","Explore","Plan"],"skills":["update-config","debug","simplify","batch","loop","claude-api"],"plugins":[],"uuid":"338fc4ec-9ca8-472e-8ac3-d174c8e2d0ab","fast_mode_state":"off"}
{"type":"assistant","message":{"id":"msg_1777257113585","type":"message","role":"assistant","content":[{"type":"tool_use","id":"call_QqPSqGGfyoYSmAypQaXLXyip","name":"Bash","input":{"command":"pwd","description":"Print current working directory","timeout":120000}}],"model":"gpt-5.4","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0},"context_management":null},"parent_tool_use_id":null,"session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","uuid":"60f332f4-a2fb-4432-8b5c-7037000360f2"}
{"type":"assistant","message":{"id":"msg_1777257113585","type":"message","role":"assistant","content":[{"type":"tool_use","id":"call_ngA6KDY4Z9cEtxfF9bbW5MuJ","name":"Bash","input":{"command":"python3 -c \"import json; print(json.load(open('package.json'))['name'])\"","description":"Print package name from package.json","timeout":120000}}],"model":"gpt-5.4","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0},"context_management":null},"parent_tool_use_id":null,"session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","uuid":"1c32b7be-4b9a-4642-a6f4-f13335361557"}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"call_QqPSqGGfyoYSmAypQaXLXyip","type":"tool_result","content":"/Users/orca/ai/snail-shell","is_error":false}]},"parent_tool_use_id":null,"session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","uuid":"0f7cc873-107d-4f01-887f-ff7283a2242f","timestamp":"2026-04-27T02:31:53.972Z","tool_use_result":{"stdout":"/Users/orca/ai/snail-shell","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false}}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"call_ngA6KDY4Z9cEtxfF9bbW5MuJ","type":"tool_result","content":"snail-shell","is_error":false}]},"parent_tool_use_id":null,"session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","uuid":"e8e67969-9c7d-493e-b658-15b69bde1ae2","timestamp":"2026-04-27T02:31:54.175Z","tool_use_result":{"stdout":"snail-shell","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false}}
{"type":"assistant","message":{"id":"msg_1777257115877","type":"message","role":"assistant","content":[{"type":"text","text":"snail-shell"}],"model":"gpt-5.4","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0},"context_management":null},"parent_tool_use_id":null,"session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","uuid":"ad0fc41b-f9b1-4dfa-a667-76d20374087f"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":7620,"duration_api_ms":7054,"num_turns":3,"result":"snail-shell","stop_reason":"end_turn","session_id":"f7607aaf-5e74-44fc-b503-6a78a73ef476","total_cost_usd":0.091765,"usage":{"input_tokens":15163,"cache_creation_input_tokens":0,"cache_read_input_tokens":25600,"output_tokens":126,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"},"modelUsage":{"gpt-5.4":{"inputTokens":15163,"outputTokens":126,"cacheReadInputTokens":25600,"cacheCreationInputTokens":0,"webSearchRequests":0,"costUSD":0.091765,"contextWindow":200000,"maxOutputTokens":32000}},"permission_denials":[],"fast_mode_state":"off","uuid":"e699c508-eb7e-4f30-b11b-7eb24abe969b"}
```

### 结构事实

1. Claude 同时存在过程事件与原生 terminal `result` 事件。
2. tool use 出现在 `assistant.message.content[].type = "tool_use"`。
3. tool result 以 `user.message.content[].type = "tool_result"` 回流。
4. 最终答复文本在本次采样里出现了两次：
   - 一次是 assistant text message
   - 一次是 `result.result`

---

## Codex CLI

### Capture A

- Evidence: `captured-success`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
codex exec --json --dangerously-bypass-approvals-and-sandbox - <<'EOF'
You are validating Codex CLI JSON event format.
In the current repository, first run a shell command to print the current directory, then run a shell command to read the package name from package.json, then answer with one short sentence containing only the package name.
EOF
```

- Observed output:

```json
{"type":"thread.started","thread_id":"019dccbb-9865-7aa0-b35b-e906eaaab6d0"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"先在当前仓库里确认工作目录，再从 `package.json` 读取包名。"}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/Users/orca/ai/snail-shell\n","exit_code":0,"status":"completed"}}
{"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \"node -p \\\"require('./package.json').name\\\"\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \"node -p \\\"require('./package.json').name\\\"\"","aggregated_output":"snail-shell\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"snail-shell"}}
{"type":"turn.completed","usage":{"input_tokens":22516,"cached_input_tokens":13056,"output_tokens":186}}
```

### Capture B

- Evidence: `captured-success`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
codex exec --json --dangerously-bypass-approvals-and-sandbox - <<'EOF'
You are validating Codex CLI JSON event format.
In the current repository, first list files in the root, then read package.json with a shell command, then answer with exactly: done.
EOF
```

- Observed output:

```json
{"type":"thread.started","thread_id":"019dccbb-986d-7f82-9c55-ceea2b5e3d3c"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"我会先在仓库根目录列出文件，再用 shell 读取 `package.json`，完成后只返回指定内容。"}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'cat package.json'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'cat package.json'","aggregated_output":"{\n  \"name\": \"snail-shell\",\n  \"version\": \"1.0.0\",\n  \"description\": \"\",\n  \"main\": \"dist/src/index.js\",\n  \"scripts\": {\n    \"generate-types\": \"tsx scripts/generate-types.ts\",\n    \"build\": \"npm run generate-types && npm run lint && node -e \\\"require('fs').rmSync('dist',{recursive:true,force:true})\\\" && npx tsc && node dist/scripts/build-dist.js\",\n    \"lint\": \"eslint .\",\n    \"lint:fix\": \"eslint . --fix\",\n    \"check\": \"npm run test\",\n    \"start\": \"npm run build && node dist/src/main.js\",\n    \"service:start\": \"npm run build && node dist/src/bin/server-control.js start\",\n    \"service:stop\": \"node dist/src/bin/server-control.js stop\",\n    \"service:status\": \"node dist/src/bin/server-control.js status\",\n    \"test\": \"npm run build && node dist/scripts/run-tests.js\"\n  },\n  \"keywords\": [],\n  \"author\": \"\",\n  \"license\": \"MIT\",\n  \"type\": \"commonjs\",\n  \"dependencies\": {\n    \"better-sqlite3\": \"^12.9.0\",\n    \"express\": \"^5.2.1\",\n    \"ws\": \"^8.20.0\"\n  },\n  \"devDependencies\": {\n    \"@eslint/js\": \"^10.0.1\",\n    \"@types/better-sqlite3\": \"^7.6.13\",\n    \"@types/express\": \"^5.0.6\",\n    \"@types/node\": \"^25.6.0\",\n    \"@types/ws\": \"^8.18.1\",\n    \"eslint\": \"^10.2.0\",\n    \"tsx\": \"^4.21.0\",\n    \"typescript\": \"^6.0.2\",\n    \"typescript-eslint\": \"^8.58.2\"\n  }\n}\n","exit_code":0,"status":"completed"}}
{"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc 'ls -1'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc 'ls -1'","aggregated_output":"AGENTS.md\nCLAUDE.md\nCONTRIBUTING.md\nLICENSE\nLOGGING_REVIEW.md\nREADME.en.md\nREADME.md\nSECURITY.md\nbin\nconfig\nconfig.json\ndata\ndist\ndocs\neslint.config.mjs\nlogs\nnode_modules\npackage-lock.json\npackage.json\npids\nscripts\nsrc\ntests\ntsconfig.json\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"done"}}
{"type":"turn.completed","usage":{"input_tokens":22969,"cached_input_tokens":13056,"output_tokens":203}}
```

### 结构事实

1. Codex 成功路径是 item-stream，不是 `tool_use` stream。
2. 工具样步骤表现为 `item.type = "command_execution"`。
3. 过程说明表现为 `item.type = "agent_message"`。
4. 成功结束时只有 `turn.completed`，并没有单独的 native final-result envelope。
5. 最终正文当前只是最后一个 `agent_message` item。

---

## OpenCode CLI

### Capture A

- Evidence: `captured-success`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
env -i HOME="$HOME" PATH="$PATH" SHELL="$SHELL" TERM="$TERM" opencode run --format json --dangerously-skip-permissions --model "my-geek/gpt-5.4" "In the current repository, first run a shell command to print the current directory, then run a shell command to read the package name from package.json, then answer with one short sentence containing only the package name."
```

- Observed output:

```json
{"type":"step_start","timestamp":1777259025381,"sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","part":{"id":"prt_dcce493e100116dgtQWt54MMVT","messageID":"msg_dcce47a88001HtFc2k8QyXokeX","sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","type":"step-start"}}
{"type":"tool_use","timestamp":1777259026169,"sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","part":{"id":"prt_dcce493e3001jIyoLRg70JoR5f","messageID":"msg_dcce47a88001HtFc2k8QyXokeX","sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","type":"tool","tool":"bash","callID":"call_f8USitjvf5xGBL1W9oqd6mzt","state":{"status":"completed","input":{"command":"pwd && node -p \"require('./package.json').name\"","description":"Prints directory and package name","timeout":120000,"workdir":"/Users/orca/ai/snail-shell"},"output":"/Users/orca/ai/snail-shell\nsnail-shell\n","metadata":{"output":"/Users/orca/ai/snail-shell\nsnail-shell\n","exit":0,"description":"Prints directory and package name","truncated":false},"title":"Prints directory and package name","time":{"start":1777259025981,"end":1777259026162}}}}
{"type":"step_finish","timestamp":1777259026324,"sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","part":{"id":"prt_dcce496f80013lZkZD9OVLKDJu","reason":"tool-calls","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","messageID":"msg_dcce47a88001HtFc2k8QyXokeX","sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","type":"step-finish","tokens":{"total":9123,"input":6295,"output":268,"reasoning":0,"cache":{"write":0,"read":2560}},"cost":0}}
{"type":"step_start","timestamp":1777259028351,"sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","part":{"id":"prt_dcce49f7d001aJLB28uuFRrF7c","messageID":"msg_dcce4983b0012AViWzBU6VkvgA","sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","type":"step-start"}}
{"type":"text","timestamp":1777259028605,"sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","part":{"id":"prt_dcce49f8c0015Vla4Bihr3MxDd","messageID":"msg_dcce4983b0012AViWzBU6VkvgA","sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","type":"text","text":"snail-shell","time":{"start":1777259028603,"end":1777259028603}}}
{"type":"step_finish","timestamp":1777259028829,"sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","part":{"id":"prt_dcce4a07e001AUzOe2zPXpogLu","reason":"stop","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","messageID":"msg_dcce4983b0012AViWzBU6VkvgA","sessionID":"ses_2331b869fffeKOXJRtFOf72PXy","type":"step-finish","tokens":{"total":8944,"input":233,"output":7,"reasoning":0,"cache":{"write":0,"read":8704}},"cost":0}}
```

### Capture B

- Evidence: `captured-success`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
env -i HOME="$HOME" PATH="$PATH" SHELL="$SHELL" TERM="$TERM" opencode run --format json --dangerously-skip-permissions --model "my-geek/gpt-5.4" "In the current repository, first list files in the root, then read package.json with a shell command, then answer with exactly: done."
```

- Observed output:

```json
{"type":"step_start","timestamp":1777259026509,"sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","part":{"id":"prt_dcce49849001ZIHI4AIhsmAxxt","messageID":"msg_dcce47c8a00102FVAduEdataF0","sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","type":"step-start"}}
{"type":"tool_use","timestamp":1777259028481,"sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","part":{"id":"prt_dcce49ee9001NjfChFQPXO2oaq","messageID":"msg_dcce47c8a00102FVAduEdataF0","sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","type":"tool","tool":"bash","callID":"call_Bz5QUki6WErjskyKHoUaKgGH","state":{"status":"completed","input":{"command":"ls && jq . package.json","description":"Lists root files and reads package.json","timeout":120000,"workdir":"/Users/orca/ai/snail-shell"},"output":"AGENTS.md\nCLAUDE.md\nCONTRIBUTING.md\nLICENSE\nLOGGING_REVIEW.md\nREADME.en.md\nREADME.md\nSECURITY.md\nbin\nconfig\nconfig.json\ndata\ndist\ndocs\neslint.config.mjs\nlogs\nnode_modules\npackage-lock.json\npackage.json\npids\nscripts\nsrc\ntests\ntsconfig.json\n{\n  \"name\": \"snail-shell\",\n  \"version\": \"1.0.0\",\n  \"description\": \"\",\n  \"main\": \"dist/src/index.js\",\n  \"scripts\": {\n    \"generate-types\": \"tsx scripts/generate-types.ts\",\n    \"build\": \"npm run generate-types && npm run lint && node -e \\\"require('fs').rmSync('dist',{recursive:true,force:true})\\\" && npx tsc && node dist/scripts/build-dist.js\",\n    \"lint\": \"eslint .\",\n    \"lint:fix\": \"eslint . --fix\",\n    \"check\": \"npm run test\",\n    \"start\": \"npm run build && node dist/src/main.js\",\n    \"service:start\": \"npm run build && node dist/src/bin/server-control.js start\",\n    \"service:stop\": \"node dist/src/bin/server-control.js stop\",\n    \"service:status\": \"node dist/src/bin/server-control.js status\",\n    \"test\": \"npm run build && node dist/scripts/run-tests.js\"\n  },\n  \"keywords\": [],\n  \"author\": \"\",\n  \"license\": \"MIT\",\n  \"type\": \"commonjs\",\n  \"dependencies\": {\n    \"better-sqlite3\": \"^12.9.0\",\n    \"express\": \"^5.2.1\",\n    \"ws\": \"^8.20.0\"\n  },\n  \"devDependencies\": {\n    \"@eslint/js\": \"^10.0.1\",\n    \"@types/better-sqlite3\": \"^7.6.13\",\n    \"@types/express\": \"^5.0.6\",\n    \"@types/node\": \"^25.6.0\",\n    \"@types/ws\": \"^8.18.1\",\n    \"eslint\": \"^10.2.0\",\n    \"tsx\": \"^4.21.0\",\n    \"typescript\": \"^6.0.2\",\n    \"typescript-eslint\": \"^8.58.2\"\n  }\n}\n","metadata":{"output":"AGENTS.md\nCLAUDE.md\nCONTRIBUTING.md\nLICENSE\nLOGGING_REVIEW.md\nREADME.en.md\nREADME.md\nSECURITY.md\nbin\nconfig\nconfig.json\ndata\ndist\ndocs\neslint.config.mjs\nlogs\nnode_modules\npackage-lock.json\npackage.json\npids\nscripts\nsrc\ntests\ntsconfig.json\n{\n  \"name\": \"snail-shell\",\n  \"version\": \"1.0.0\",\n  \"description\": \"\",\n  \"main\": \"dist/src/index.js\",\n  \"scripts\": {\n    \"generate-types\": \"tsx scripts/generate-types.ts\",\n    \"build\": \"npm run generate-types && npm run lint && node -e \\\"require('fs').rmSync('dist',{recursive:true,force:true})\\\" && npx tsc && node dist/scripts/build-dist.js\",\n    \"lint\": \"eslint .\",\n    \"lint:fix\": \"eslint . --fix\",\n    \"check\": \"npm run test\",\n    \"start\": \"npm run build && node dist/src/main.js\",\n    \"service:start\": \"npm run build && node dist/src/bin/server-control.js start\",\n    \"service:stop\": \"node dist/src/bin/server-control.js stop\",\n    \"service:status\": \"node dist/src/bin/server-control.js status\",\n    \"test\": \"npm run build && node dist/scripts/run-tests.js\"\n  },\n  \"keywords\": [],\n  \"author\": \"\",\n  \"license\": \"MIT\",\n  \"type\": \"commonjs\",\n  \"dependencies\": {\n    \"better-sqlite3\": \"^12.9.0\",\n    \"express\": \"^5.2.1\",\n    \"ws\": \"^8.20.0\"\n  },\n  \"devDependencies\": {\n    \"@eslint/js\": \"^10.0.1\",\n    \"@types/better-sqlite3\": \"^7.6.13\",\n    \"@types/express\": \"^5.0.6\",\n    \"@types/node\": \"^25.6.0\",\n    \"@types/ws\": \"^8.18.1\",\n    \"eslint\": \"^10.2.0\",\n    \"tsx\": \"^4.21.0\",\n    \"typescript\": \"^6.0.2\",\n    \"typescript-eslint\": \"^8.58.2\"\n  }\n}\n","exit":0,"description":"Lists root files and reads package.json","truncated":false},"title":"Lists root files and reads package.json","time":{"start":1777259028341,"end":1777259028474}}}}
{"type":"step_finish","timestamp":1777259028637,"sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","part":{"id":"prt_dcce49ffe001aFxIyBf3oAeJPx","reason":"tool-calls","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","messageID":"msg_dcce47c8a00102FVAduEdataF0","sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","type":"step-finish","tokens":{"total":9125,"input":7305,"output":284,"reasoning":0,"cache":{"write":0,"read":1536}},"cost":0}}
{"type":"step_start","timestamp":1777259030501,"sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","part":{"id":"prt_dcce4a7e3001VG9949q0kotppL","messageID":"msg_dcce4a18a001Ij5U296xHGAB3s","sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","type":"step-start"}}
{"type":"text","timestamp":1777259030646,"sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","part":{"id":"prt_dcce4a84c001ZgmeWLGMOS89fj","messageID":"msg_dcce4a18a001Ij5U296xHGAB3s","sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","type":"text","text":"done","time":{"start":1777259030644,"end":1777259030644}}}
{"type":"step_finish","timestamp":1777259030773,"sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","part":{"id":"prt_dcce4a876001CN6uB5LxSOfFci","reason":"stop","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","messageID":"msg_dcce4a18a001Ij5U296xHGAB3s","sessionID":"ses_2331b8492ffez25v9Jf5ripNHV","type":"step-finish","tokens":{"total":9388,"input":679,"output":5,"reasoning":0,"cache":{"write":0,"read":8704}},"cost":0}}
```

### Capture C

- Evidence: `captured-failure`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
opencode run --format json --dangerously-skip-permissions --model "my-geek/gpt-5.4" "hello"
```

- Observed output:

```text
Error: Session not found
```

### 结构事实

1. OpenCode 成功路径是连续过程流。
2. 工具样步骤表现为 `tool_use`，其 `part.state` 内已带 input、output、exit metadata、time。
3. 终局正文只是普通 `text`。
4. OpenCode 当前不存在类似 Claude `result` 的原生 terminal result 事件。
5. 当前 shell 环境继承的 `OPENCODE_*` desktop 变量会改变 `run` 行为，因此实机采样必须在纯净环境里执行。

---

## Gemini CLI

### Capture A

- Evidence: `captured-failure`
- Working directory: `/Users/orca/ai/snail-shell`
- Command:

```bash
gemini -p "In the current repository, first run a shell command to print the current directory, then run a shell command to read the package name from package.json, then answer with one short sentence containing only the package name." --output-format stream-json --approval-mode yolo
```

- Observed output:

```text
YOLO mode is enabled. All tool calls will be automatically approved.
Please set an Auth method in your /Users/orca/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA
```

### 备注

1. Gemini 当前在本机不可用。
2. 本轮设计不把 Gemini 作为核心约束来源。
3. 等后续 Gemini 可实机成功采样后，再补充它的成功路径结构事实。

---

## 本轮最小 runtime 事实集合

任何新的消息模型，至少必须能正确解释以下事实：

1. Claude 存在 native terminal `result`。
2. Claude 的过程工具调用与最终 `result` 在结构上天然分离。
3. OpenCode 只有连续过程流，最终正文只是普通 `text`。
4. Codex 只有 item stream，最终正文只是最后一个 `agent_message`。
5. OpenCode 的工具步骤是 `tool_use`。
6. Codex 的工具步骤是 `command_execution` item，不是 `tool_use`。
7. runtime 可能因环境变量、provider 配置、认证状态而直接失败。

这组 runtime 事实是后续新消息模型必须满足的最低基线。
