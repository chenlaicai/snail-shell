---
id: F2026060403
title: 前端架构重写 — React + URL 路由
from_ids: [F2026052003]
tags: [ui, react, routing, architecture]
modules: [web]
---

# F2026060403 前端架构重写 — React + URL 路由

## 背景

当前前端用原生 JS + DOM API 构建 SPA，存在结构性问题：

1. **刷新丢状态**：URL 始终 `localhost:3000`，无路由，刷新后所有导航归零
2. **手动 DOM 管理易出错**：20+ `getElementById`、15+ 事件监听、8+ 渲染函数必须按顺序调用，遗漏任何一个就是 UI 不一致
3. **app.js 臃肿**：576 行同时管理看板、对话、演进中心、知识库等所有视图
4. **CSS 布局靠手动切换**：`hidden` 属性 + `is-active` class 手动切换，grid 行分配依赖 DOM 顺序，极易出 bug

这些问题的根因是原生 JS 声明式能力不足。改用 React 可以从结构上消除这些问题。

### 为什么放弃混合架构

之前讨论过"传统页面 + 对话 SPA"的混合方案（各页面独立 HTML，只有对话页是 SPA）。但引入 React + React Router 后，客户端路由本身就解决了 URL 问题——所有页面共享一个 `index.html`，React Router 在客户端解析 URL 渲染对应组件。不需要服务端为每个路径返回不同 HTML。混合方案是原生 JS 时代的权宜之计，React 下没有意义。

## 目标

1. 用 React 重写前端，声明式渲染，状态驱动 UI
2. 用 React Router 实现 URL 路由，刷新不丢状态
3. 对话页 WebSocket 保活，内部导航不触发整页加载
4. 每个模块独立组件，改一个不影响其他

## 非目标

- 不引入 SSR（Library mode，纯客户端）
- 不改变 API 接口（只加服务端 catch-all 路由）
- 不改变视觉外观
- 不引入 Next.js / Remix 等全栈框架

## 技术选型

| 技术 | 用途 | 理由 |
|------|------|------|
| React 19 | UI 框架 | 声明式渲染，消除手动 DOM 管理 |
| React Router v7 (Library mode) | URL 路由 | 声明式路由配置，天然支持嵌套布局 |
| Zustand | 状态管理 | 轻量，适合 WebSocket 驱动的状态更新 |
| TypeScript | 类型安全 | 项目已有 TS 基础 |
| Vite | 构建工具 | 开发时 HMR，生产构建输出静态文件 |

## 设计

### URL 设计

```
/                                      → 工作区列表（首页）
/ws/:workspaceId                      → 工作区看板
/ws/:workspaceId/issue/:issueId       → Issue 对话
/ws/:workspaceId/issue/:issueId?stage=design&conv=abc → 对话 + 指定 Stage/Conversation
/evolution                            → 演进中心
/knowledge                            → 知识库
/snail-den                            → Snail Den
/prompts                              → Prompt Center
/skills                               → Skill Center
/mcps                                 → MCPs
/lobby                                → IM 大厅
```

对话页的 Stage 和 Conversation 选择通过 URL query 参数保持，刷新后能恢复。

**query 参数同步是单向初始化的：**
- 页面加载时从 URL 读 `?stage=&conv=` → 初始化 Zustand store
- 用户切换 Stage → 更新 Zustand store + `setSearchParams()`
- `searchParams` **不加进** `useEffect` 依赖，不触发重新加载数据

### 路由结构

```tsx
<Routes>
  {/* 首页 */}
  <Route path="/" element={<HomePage />} />

  {/* 工作区看板 */}
  <Route path="/ws/:workspaceId" element={<WorkspaceBoard />} />

  {/* Issue 对话 — 含 Stage/Conversation query 参数 */}
  <Route path="/ws/:workspaceId/issue/:issueId" element={<ConversationLayout />}>
    <Route index element={<ConversationView />} />
  </Route>

  {/* 管理页面 */}
  <Route path="/evolution" element={<EvolutionCenter />} />
  <Route path="/knowledge" element={<KnowledgeLibrary />} />
  <Route path="/snail-den" element={<SnailDen />} />
  <Route path="/prompts" element={<PromptCenter />} />
  <Route path="/skills" element={<SkillCenter />} />
  <Route path="/mcps" element={<McpCenter />} />
  <Route path="/lobby" element={<Lobby />} />
</Routes>
```

### 组件架构

```
src/web/
├── App.tsx                         # 根组件：Router + AppShell layout
├── main.tsx                        # 入口：createRoot
│
├── layouts/
│   └── AppShell.tsx                # 三栏布局（侧栏 + 主面板 + 上下文面板）
│                                    # 所有路由共用，通过 useLocation 决定侧栏内容
│
├── pages/
│   ├── HomePage.tsx                # 工作区列表
│   ├── WorkspaceBoard.tsx          # 工作区看板
│   ├── ConversationLayout.tsx      # 对话页布局（WebSocket 容器）
│   ├── ConversationView.tsx        # 对话内容
│   ├── EvolutionCenter.tsx
│   ├── KnowledgeLibrary.tsx
│   ├── SnailDen.tsx
│   ├── PromptCenter.tsx
│   ├── SkillCenter.tsx
│   ├── McpCenter.tsx
│   └── Lobby.tsx
│
├── components/
│   ├── Sidebar/
│   │   ├── WorkspaceTree.tsx       # 工作区树
│   │   ├── IssueList.tsx           # Issue 列表
│   │   └── PrimaryNav.tsx          # 主导航
│   ├── MessageList.tsx             # 消息列表
│   ├── Composer.tsx                # 输入区 + mention
│   ├── TaskBoard.tsx               # 任务看板三列
│   ├── StageBar.tsx                # 阶段条
│   └── ContextPanel.tsx            # 右侧上下文
│
├── hooks/
│   ├── useWebSocket.ts             # WebSocket 单连接生命周期
│   └── useWorkspace.ts             # 工作区数据获取
│
├── stores/
│   ├── conversationStore.ts        # 对话 + 消息状态 + 事件分发
│   ├── workspaceStore.ts           # 工作区状态（workspaceId 变化时自动清空 conversationStore）
│   └── appStore.ts                 # 全局状态（通知、侧栏折叠等）
│
└── services/
    ├── api.ts                      # HTTP API 客户端（fetch 封装）
    └── realtime.ts                 # WebSocket 连接逻辑（被 hook 调用）
```

### 核心模式

#### 1. 声明式路由代替手动视图切换

**原生 JS（当前）：**
```js
// 手动切换 8 个面板的 hidden/is-active
function switchPrimaryView(view) {
  setPrimaryPanel(taskBoardPanel, view === "workspaces");
  setPrimaryPanel(workspaceMain, view === "workspaces" && currentIssue);
  setPrimaryPanel(evolutionPanel, view === "evolution");
  // ... 每加一个视图都要改这里
}
```

**React：**
```tsx
// 路由自动处理，不需要手动切换
<Route path="/evolution" element={<EvolutionCenter />} />
```

#### 2. 状态驱动渲染代替手动 render 调用

**原生 JS（当前）：**
```js
// 状态变了要手动调一堆 render 函数，漏一个就是 bug
async function selectWorkspace(id) {
  state.currentWorkspace = await api(...);
  renderWorkspaces();        // 必须调
  renderActiveMessages();    // 必须调
  renderHeader();            // 必须调
  setWorkspaceSubView("board"); // 必须调
}
```

**React：**
```tsx
// 状态变了，UI 自动更新，不可能遗漏
function WorkspaceBoard() {
  const { workspaceId } = useParams();
  const [workspace, setWorkspace] = useState(null);
  useEffect(() => {
    api("GET", `/workspaces/${workspaceId}`).then(setWorkspace);
  }, [workspaceId]);
  if (!workspace) return <Loading />;
  return <TaskBoard workspace={workspace} />;
}
```

#### 3. WebSocket 生命周期绑定组件

**原生 JS（当前）：** 手动 connect/disconnect，容易忘记清理。

**React hook：** 一个 hook 管一个连接。用户切换 conversation 时，旧组件卸载（cleanup 断开），新组件挂载（建立新连接），通过 React key 控制：

```tsx
// ConversationLayout 中
<ConversationView key={conversationId} conversationId={conversationId} />
// key 变了 → React 卸载旧组件、挂载新组件 → WebSocket 自然切换
```

```tsx
function useWebSocket(conversationId: string, onMessage: (msg: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws?conversation_id=${conversationId}`);
    wsRef.current = ws;
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    return () => ws.close(); // 组件卸载自动清理
  }, [conversationId]);

  return wsRef;
}
```

WebSocket URL 格式与当前服务端一致：`/ws?conversation_id=xxx&after_event_id=yyy`。

`useWebSocket` hook 内部调用 `services/realtime.ts`：
- `realtime.ts` — WebSocket 工厂：创建连接、解析消息格式、**重连（指数退避，1s→2s→4s→8s，上限 30s）**。重连在 realtime.ts 内部完成，外部不需要管理。
- `useWebSocket.ts` — React hook：调用 realtime.ts 创建连接，绑定 useEffect 生命周期（卸载时断开），返回 ref

Zustand store 负责消息分发和状态管理：
```ts
// stores/conversationStore.ts
const useConversationStore = create((set, get) => ({
  messages: new Map(),
  currentStage: null,
  currentConversation: null,
  wsStatus: 'disconnected',

  // WebSocket 收到消息时调用
  handleMessage: (msg) => {
    if (msg.type === 'agent_event') {
      // 按 event.type 分发
      switch (msg.event.type) {
        case 'message_started': /* ... */ break;
        case 'event_appended': /* ... */ break;
        case 'status_changed': /* ... */ break;
      }
    }
    if (msg.type === 'conversation_badge') { /* ... */ }
    if (msg.type === 'stage_suggestion') { /* ... */ }
  },

  setCurrentStage: (stage) => set({ currentStage: stage }),
  clear: () => set({ messages: new Map(), currentStage: null, currentConversation: null }),
}));

// workspaceStore 监听 workspaceId 变化，自动清空 conversationStore
useWorkspaceStore.subscribe(
  (state) => state.workspaceId,
  () => useConversationStore.getState().clear()
);
```

#### 4. URL 参数代替内存状态

**原生 JS（当前）：** `state.currentWorkspace`、`state.currentIssue` 是内存变量，刷新就丢。

**React：** URL 参数就是状态来源。
```tsx
const { workspaceId, issueId } = useParams();
const [searchParams] = useSearchParams();
const stageId = searchParams.get('stage');
const conversationId = searchParams.get('conv');
// 刷新后全部从 URL 自动恢复
```

#### 5. 侧栏通过 AppShell 统一管理

AppShell 是 layout route，包裹所有页面。侧栏在 AppShell 内部，通过 `useLocation()` 判断当前路由，渲染对应的侧栏内容。

侧栏映射规则：

| 路由 | 侧栏内容 |
|------|---------|
| `/` | 工作区树 + 新建按钮 |
| `/ws/:workspaceId` | 工作区树 + Issue 列表 |
| `/ws/:workspaceId/issue/:issueId` | 工作区树 + Issue 列表 + Conversation 列表 |
| `/evolution` | 演进目录 |
| `/knowledge` | 知识库导航 |
| `/snail-den` | Snail Den 导航 |
| 其他管理页面 | 仅主导航 |

```tsx
function AppShell() {
  const location = useLocation();
  const path = location.pathname;

  function renderSidebarContent() {
    if (path === '/' ) return <WorkspaceTree />;
    if (/^\/ws\/[^/]+\/issue\/[^/]+$/.test(path)) return <><WorkspaceTree /><IssueList /><ConversationList /></>;
    if (/^\/ws\/[^/]+$/.test(path)) return <><WorkspaceTree /><IssueList /></>;
    if (path === '/evolution') return <EvolutionSidebar />;
    if (path === '/knowledge') return <KnowledgeSidebar />;
    if (path === '/snail-den') return <SnailDenSidebar />;
    return null; // 其他页面只显示主导航
  }

  return (
    <div className="app-shell" data-primary-view={currentView} data-workspace-view={subView}>
      <Sidebar>
        <PrimaryNav />
        {renderSidebarContent()}
      </Sidebar>
      <main className="main-panel">
        <Outlet />
      </main>
      <ContextPanel />
    </div>
  );
}
```

`data-primary-view` 和 `data-workspace-view` 从路由路径推导：
```tsx
const path = location.pathname;
const isBoard = /^\/ws\/[^/]+$/.test(path);
const isConversation = /^\/ws\/[^/]+\/issue\/[^/]+$/.test(path);
const dataWorkspaceView = isConversation ? 'conversation' : isBoard ? 'board' : undefined;
const dataPrimaryView = path === '/' ? 'workspaces' : path.split('/')[1] || 'workspaces';
```

演进中心有自己的 workspaceId `"evolution-center"`，路由 `/ws/evolution-center/issue/xxx` 自然匹配，不需要特殊处理。

### 数据加载策略

不使用 SWR / React Query。数据驱动模式：

- **初始加载**：`useEffect` + `fetch` → 存入组件 state
- **实时更新**：WebSocket 推送到 Zustand store → React 自动重渲染
- **不需要 REST 轮询**，不需要 stale-while-revalidate

```tsx
function WorkspaceBoard() {
  const { workspaceId } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api("GET", `/workspaces/${workspaceId}`)
      .then(setWorkspace)
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return <Skeleton />;
  if (!workspace) return <ErrorState />;
  return <TaskBoard workspace={workspace} />;
}
```

### CSS 集成

React 组件直接用 `className` 字符串引用现有 CSS class，不引入 CSS Modules 或 styled-components。

```tsx
function TaskCard({ issue }) {
  return (
    <div className="task-card" onClick={() => navigate(`/ws/${wsId}/issue/${issue.id}`)}>
      <div className="task-body">
        <div className="task-top-row">
          <span className="task-title">{issue.title}</span>
        </div>
      </div>
    </div>
  );
}
```

现有 `src/web/styles/` 目录下的 CSS 文件全部保留，React 组件引用同样的 class 名，视觉不变。

现有 CSS 大量使用 `[data-primary-view]`、`[data-workspace-view]` 等属性选择器。React 组件在 AppShell 根元素上保留这些 `data-*` 属性，确保样式继续生效。

### 错误处理

- **API 调用失败**：toast 通知（复用现有 `#app-notice` 样式）
- **WebSocket 断连**：显示"重连中..."状态，自动重连（指数退避）
- **权限不足**：跳转首页
- **路由不匹配**：React Router 的 `*` catch-all 显示 404 页面

### Vite + Express 集成

**开发时：**
```
Vite dev server (5173)  →  前端（HMR）
Express server (3001)   →  API + WebSocket
```
Vite 配置 proxy：
```ts
// vite.config.ts
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    }
  }
}
```

**生产时：**
```
Express server (3001)   →  static('dist/web') + catch-all + API + WebSocket
```
```ts
// server.ts
app.use(express.static('dist/web'));
app.get('*', (req, res) => res.sendFile('dist/web/index.html'));
```

## 服务端改动

在 API 路由之后加 catch-all：

```ts
// src/interaction-entry/api/server.ts
app.use(express.static(path.join(__dirname, '../../dist/web')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../dist/web/index.html'));
});
```

API 接口不变，只加了静态文件服务和 catch-all。

## 实现分 Part

### Part 1a：项目搭建 + 首页

- Vite + React + TypeScript + Zustand 项目初始化
- AppShell 布局（三栏，复用现有 CSS）
- 首页 `/`（工作区列表，调 API 渲染）
- 侧栏根据路由切换内容（PrimaryNav + WorkspaceTree）
- 服务端 catch-all 路由
- Vite proxy 配置

### Part 1b：工作区看板

- `/ws/:workspaceId` 路由
- TaskBoard 组件（从现有 `task-board.js` 迁移）
- 侧栏 WorkspaceTree + IssueList

### Part 1c：对话页

- `/ws/:workspaceId/issue/:issueId` 路由
- ConversationLayout（WebSocket 容器）
- ConversationView（消息列表 + Composer）
- `useWebSocket` hook
- conversationStore（消息分发、重连）
- Stage/Conversation query 参数同步

### Part 1d：导航完善

- 浏览器前进/后退
- 直接访问 URL 恢复状态

### Part 2：管理页面

- 演进中心 `/evolution`
- 知识库 `/knowledge`
- Snail Den `/snail-den`
- Prompt Center `/prompts`
- Skill Center `/skills`
- MCPs `/mcps`
- IM 大厅 `/lobby`

### Part 3：细节完善

- Boss mentions banner
- Stage 推进/转移
- 上下文面板
- 响应式布局
- 错误处理

## 文件变更

| 操作 | 文件 |
|------|------|
| 新建 | `src/web/index.html`（React 入口 HTML） |
| 新建 | `src/web/main.tsx`（createRoot） |
| 新建 | `src/web/App.tsx`（Router 配置） |
| 新建 | `src/web/layouts/AppShell.tsx` |
| 新建 | `src/web/pages/*.tsx`（各页面组件） |
| 新建 | `src/web/components/*.tsx`（共享组件） |
| 新建 | `src/web/hooks/*.ts`（自定义 hooks） |
| 新建 | `src/web/stores/*.ts`（Zustand stores） |
| 新建 | `src/web/services/api.ts` |
| 新建 | `src/web/services/realtime.ts` |
| 新建 | `src/web/tsconfig.json`（前端 TS 配置） |
| 新建 | `src/web/vite.config.ts`（Vite 配置 + proxy） |
| 改动 | `src/interaction-entry/api/server.ts`（静态文件 + catch-all） |
| 删除 | `src/web/app.js`（被 React 替代） |
| 删除 | `src/web/ui-shell.js`（被 AppShell.tsx 替代） |
| 删除 | `src/web/primary-view.js`（被 React Router 替代） |
| 删除 | `src/web/workspace-controller.js`（逻辑分散到组件和 hooks） |
| 保留 | `src/web/styles/`（CSS 不变，React 组件引用同样的 class） |

### 旧逻辑迁移映射

| 旧函数（原位置） | 去向（React） | 说明 |
|-----------------|--------------|------|
| `selectWorkspace(id)` | `navigate("/ws/" + id)` | URL 变化，组件通过 `useParams` 自动加载 |
| `selectIssue(id)` | `navigate("/ws/" + wsId + "/issue/" + id)` | URL 变化，ConversationLayout 自动加载 |
| `backToBoard()` | `navigate("/ws/" + wsId)` | URL 变化 |
| `switchPrimaryView(view)` | React Router 自动处理 | 不需要手动切换 |
| `archiveIssue(id)` | `WorkspaceBoard` 组件内方法 | 调 API + 更新组件 state |
| `createIssue()` | `WorkspaceBoard` 组件内方法 | 调 API + navigate |
| `reloadSnailConfig()` | `WorkspaceBoard` 组件内方法 | 调 API + 刷新 |
| `send()` / `sendStructuredResponse` | `ConversationView` 组件内方法 | 调 API + WebSocket |
| `renderWorkspaces()` | 不需要 | React 自动重渲染 |
| `renderActiveMessages()` | 不需要 | React 自动重渲染 |
| `renderHeader()` | 不需要 | React 自动重渲染 |
| `setWorkspaceSubView()` | 不需要 | React Router 自动处理 |

## 验证

**Part 1a：**
- 访问 `/` → 工作区列表正常显示
- 点击工作区 → URL 变为 `/ws/xxx` → 看板显示

**Part 1b：**
- 看板显示 Issue 列表
- 点击 Issue → URL 变为 `/ws/xxx/issue/yyy`

**Part 1c：**
- 对话页加载，WebSocket 连接
- 消息正常显示
- 切换 Stage → URL query 参数变 → 页面不刷新
- 刷新对话页 → 从 URL 恢复 workspace + issue + stage + conversation → WebSocket 重连

**Part 1d：**
- 浏览器前进/后退正常
- 直接访问任何 URL 正常加载

## 风险

- 全量重写前端，工作量大（但原生 JS 的结构性问题无法渐进修复）
- 需要引入构建工具（Vite），增加构建步骤
- CSS 可能需要微调以适配 React 组件结构（但 class 名不改，影响有限）
