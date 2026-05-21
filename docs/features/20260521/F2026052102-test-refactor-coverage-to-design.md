# F2026052102 测试重构：删除覆盖率填充式测试，保留业务逻辑与核心设计契约看护

## 背景

当前测试套件存在大量「源码字符串匹配」测试——读取 `.js`/`.css`/`.sh` 源文件，检查是否包含特定 CSS class 名称、JS 标识符、shell 命令字符串或属性值。这类测试绑定在实现细节上，UI 任何 CSS 微调或脚本重构都会导致测试崩溃，但业务逻辑完全没变。

同时，部分测试为覆盖率而编写，而非看护业务行为或核心设计契约。

## 目标

- 删除无业务语义的源码字符串匹配测试
- 精简有业务语义但断言方式绑定实现的测试——改为行为级契约断言
- 确保删除后测试套件仍然全部通过

## 非目标

- 不修改保留测试的逻辑或行为级断言内容
- 不新增测试
- 不修改被测代码

## 变更

### 删除（5 个文件，共 357 行）

| 文件 | 行数 | 原因 |
|------|------|------|
| `tests/web/workspace-layout-test.ts` | 241 | CSS rule 提取 + 属性值匹配，UI 微调即崩溃 |
| `tests/web/knowledge-center-test.ts` | 41 | 源码字符串匹配 CSS class 名称和中文 UI 文本 |
| `tests/web/ui-entrypoint-test.ts` | 41 | 读取 index.html/app.js/project-config-view.js 匹配 HTML 结构、JS 标识符——源码结构由运行时隐式验证 |
| `tests/scripts/service-entrypoint-test.ts` | 28 | 读取 bin/snail-service 和 package.json 匹配 git/npm shell 命令字符串——由 npm run service:* 隐式验证 |
| `tests/scripts/build-dist-test.ts` | 25 | build 产物文件存在性检查，属于 CI 阶段关注点 |
| `tests/web/helpers/shell-dom.ts` | ~30 | ui-entrypoint-test 删除后无引用 |

### 重构（2 个文件）

| 文件 | 变更 |
|------|------|
| `tests/web/feature-list-view-test.ts` | 移除 app.js/styles 源码字符串匹配 30 行，保留 `buildFeatureGroups` 业务逻辑测试 |
| `tests/web/primary-view-test.ts` | 移除 CSS class（`active`/`is-active`）和 ARIA（`aria-current`）断言，保留视图切换行为契约：面板可见性、viewRelated 过滤、未知视图回退 |

### 净效果

- 净减 ~430 行
- 测试文件 40→35 个
- 35 个测试全部通过

### 提示词强化

| 文件 | 变更 |
|------|------|
| `S-03-研发者手册.md` | 新增测试编写原则：严禁源码字符串匹配，断言必须通过运行时行为 |
| `S-04-检视者手册.md` | 新增测试质量审查原则：源码字符串匹配反模式必须在检视中指出 |
| `developer-handbook/SKILL.md` | 阶段四自检清单新增测试用例质量自查项 |
| `reviewer-handbook/SKILL.md` | 对抗性检查新增测试质量项，自检清单同步更新 |
