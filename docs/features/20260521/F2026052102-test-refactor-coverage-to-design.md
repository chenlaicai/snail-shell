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

## 设计

### 源码字符串匹配 vs 运行时行为验证

源码字符串匹配反模式的特征：`fs.readFileSync` + `str.includes` 匹配 CSS class 名称、shell 命令字符串、HTML tag/属性、JS 标识符。这类测试绑定在实现文本层面，实现文本微调即崩溃，不反映业务语义是否正确。

替代做法：测试通过运行时行为验证——函数调用、API 交互、状态转移、事件流程——断言业务结果而非源码文本。

### CSS class / aria 属性：源码匹配与运行时行为断言的区别

CSS class 值（如 `active`、`is-active`）和 aria 属性值不宜通过读取源码文件做字符串匹配断言，因为绑在实现文本而非行为上。

但 `aria-current="page"` 等无障碍语义是面向辅助技术的运行时 API 契约——删除 `setAttribute("aria-current", "page")` 不会触发任何 CSS/视觉变化，但它会破坏屏幕阅读器对当前导航页的识别。这类可访问性契约应通过运行时 DOM 行为（`element.getAttribute("aria-current")`）保留断言。

规则边界：禁止源码字符串匹配 CSS class/aria，允许通过运行时 DOM 行为验证可访问性契约。

## 生效路径

- 测试编写原则通过 `.meta/prompts/prompts/S-03-研发者手册.md` 长期生效——研发者在测试编写时受此规则约束
- 测试质量审查原则通过 `.meta/prompts/prompts/S-04-检视者手册.md` 长期生效——检视者在检视时必须指出源码字符串匹配反模式
- 详细操作流程在 `developer-handbook/SKILL.md` 和 `reviewer-handbook/SKILL.md` 中补充
- 测试文件 `tests/web/primary-view-test.ts` 作为正确测试方式的参考范例

## 改动范围

### 删除（6 个文件，共 357 行）

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
| `tests/web/primary-view-test.ts` | 移除 CSS class（`active`/`is-active`）的源码字符串匹配断言；保留视图切换行为契约（面板可见性、viewRelated 过滤、未知视图回退）；新增运行时 DOM 行为断言验证 `aria-current="page"` 可访问性契约 |

### 提示词强化（4 个文件）

| 文件 | 变更 |
|------|------|
| `S-03-研发者手册.md` | 新增测试编写原则：严禁源码字符串匹配，断言必须通过运行时行为；允许通过运行时 DOM 行为验证可访问性契约 |
| `S-04-检视者手册.md` | 新增测试质量审查原则：源码字符串匹配反模式必须在检视中指出；运行时 DOM 行为验证可访问性契约是合理测试方式 |
| `developer-handbook/SKILL.md` | 阶段四自检清单新增测试用例质量自查项 |
| `reviewer-handbook/SKILL.md` | 对抗性检查新增测试质量项，自检清单同步更新 |

### 净效果

- 净减 ~430 行
- 测试文件 40→35 个
- 35 个测试全部通过

## 验证

- `npm run check` 通过（含全部 35 个测试）
- `npm run lint` 通过
- 人工确认 `primary-view-test.ts` 中 `aria-current="page"` 断言在模拟的 DOM 行为层面正确验证了活跃导航状态

## 风险与决策记录

### 风险：删除源码匹配测试后失去的覆盖

删除的 5 个测试看护的是源码文本层面的不变性（特定 CSS class 存在、特定 HTML 结构存在），而非业务行为。这些不变性如被破坏，用户可见的功能也会一并崩溃（页面渲染异常、导航无法切换），这些场景由运行时功能测试和浏览器层 UI 测试覆盖。

### 决策：aria-current 断言保留方式

首轮实现中，`primary-view-test.ts` 将 `aria-current` 与 CSS class 一并归为"DOM 细粒度实现细节"删除。检视指出 aria-current 是面向辅助技术的 API 契约而非实现细节。结论：通过 FakeElement 的 `setAttribute`/`getAttribute` 实际实现运行时 DOM 行为断言，而非回退到源码字符串匹配。

## 范围变更记录

| 变更 | 来源 | 说明 |
|------|------|------|
| S-03/S-04 ARIA 规则收窄 | 检视者 | "不断言 aria 属性"改为"不以源码字符串匹配方式断言；可通过运行时 DOM 行为验证可访问性契约" |
| primary-view-test.ts 恢复 aria-current 断言 | 检视者 | FakeElement 实现真实的 setAttribute/removeAttribute，通过 `getAttribute("aria-current")` 做运行时行为断言 |
| feature 文档按模板补齐 | 检视者 | 补齐 ## 设计、## 生效路径、## 改动范围、## 验证、## 风险与决策记录、## 范围变更记录 |
