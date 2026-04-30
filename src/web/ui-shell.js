const uiShellTemplate = `  <header>
    <h1><span>Snail</span> Shell</h1>
    <div class="project-pill" id="top-project-state">未选择项目</div>
  </header>
  <div id="app-notice" style="display:none; padding:10px 20px; background:#1d4ed8; color:white; font-size:13px;"></div>

  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-main">
        <section class="panel-section compact">
          <div class="panel-title">Workspace</div>
          <div class="project-summary-card view-related" id="project-summary-card" data-view-related="projects">
            <div class="name">未选择项目</div>
            <div class="meta">选择项目后查看当前协作线</div>
          </div>
          <div class="project-summary-card view-related" data-view-related="knowledge" hidden>
            <div class="name">知识中心</div>
            <div class="meta">管理可复用知识、审批候选知识，并查看当前项目知识。</div>
          </div>
          <div class="button-row view-related" data-view-related="projects" style="margin-top: 12px;">
            <button class="primary-button" id="new-project-btn">新建项目</button>
          </div>
          <div class="primary-nav">
            <button class="primary-nav-button active" id="nav-projects" aria-current="page"><span>项目管理</span><span>Projects</span></button>
            <button class="primary-nav-button" id="nav-knowledge"><span>知识中心</span><span>Knowledge</span></button>
          </div>
        </section>

        <section class="panel-section view-related" data-view-related="projects">
          <div class="panel-title">Projects</div>
          <div class="project-list" id="project-list"></div>
        </section>

        <section class="panel-section view-related" data-view-related="projects">
          <div class="panel-title">Features</div>
          <div class="button-row" style="margin-bottom: 12px;">
            <button class="secondary-button" id="new-feature-btn">新建 Feature</button>
          </div>
          <div class="feature-list" id="feature-list"></div>
        </section>

        <section class="panel-section view-related" data-view-related="projects">
          <div class="panel-title">Conversations</div>
          <div class="button-row" style="margin-bottom: 12px;">
            <button class="secondary-button" id="new-conversation-btn">新建对话</button>
          </div>
          <div class="conversation-list" id="conversation-list"></div>
        </section>
      </div>

      <div class="sidebar-footer">
        <div class="nav-actions">
          <button class="nav-action-button" data-inspector-open="prompts"><span>Prompt Center</span><span>配置</span></button>
          <button class="nav-action-button" data-inspector-open="system"><span>System State</span><span>诊断</span></button>
        </div>
      </div>
    </aside>

    <main class="main-panel">
      <div class="workspace-main view-pane is-active" id="workspace-main" data-view-pane="projects">
      <div class="workspace-header">
        <div class="workspace-heading">
          <h2 id="conversation-title">未选择对话</h2>
          <div class="breadcrumbs" id="conversation-breadcrumbs">请选择一个项目。</div>
          <div class="workspace-status-row">
            <button type="button" id="workspace-stage-badge" class="badge">无活跃阶段</button>
            <span class="workspace-next-step" id="workspace-next-step">选择项目以开始。</span>
          </div>
        </div>
        <button class="ghost-button" data-inspector-open="stage">Context</button>
      </div>

      <div id="boss-mentions-banner" class="boss-mentions-banner"></div>

      <div id="messages"></div>

      <div class="composer">
        <div id="reply-banner" class="reply-banner">
          <div id="reply-banner-text"></div>
          <button type="button" id="reply-cancel" class="reply-cancel">取消</button>
        </div>
        <textarea id="input" placeholder="输入 @Design Snail 与指定 snail 对话；未指定时默认发送给当前主 snail" rows="2"></textarea>
        <div class="composer-hints">
          <div id="mention-status" class="mention-status"></div>
          <div id="mention-suggestions" class="mention-suggestions"></div>
        </div>
        <div class="button-row">
          <button class="primary-button" id="send-btn">发送</button>
          <button class="danger-button" id="interrupt-btn" type="button" hidden>中断 Snail</button>
        </div>
      </div>
      </div>
      <div class="knowledge-panel view-pane" id="knowledge-panel" data-view-pane="knowledge" hidden>
        <div id="knowledge-summary"></div>
        <div class="knowledge-toolbar">
          <button class="primary-button" id="knowledge-library-btn">知识库</button>
          <button class="secondary-button" id="knowledge-candidates-btn">待审批</button>
          <button class="ghost-button" id="knowledge-project-btn">当前项目知识</button>
        </div>
        <div class="knowledge-layout">
          <div class="knowledge-list" id="knowledge-list"></div>
          <div class="knowledge-detail" id="knowledge-detail"></div>
        </div>
      </div>
    </main>

    <aside class="context-panel view-related" data-view-related="projects">
      <div class="context-rail">
        <section class="context-card" id="stage-summary-card"></section>
        <section class="context-card" id="participants-summary-card"></section>
        <section class="context-card" id="deliverables-summary-card"></section>
      </div>
    </aside>
  </div>

  <div class="drawer-backdrop" id="drawer-backdrop"></div>
  <aside class="inspector-drawer" id="inspector-drawer" aria-hidden="true">
    <div class="inspector-header">
      <div class="inspector-title-row">
        <div>
          <h2>Inspector</h2>
          <div class="meta">按需查看规则、产物、提示词和系统状态</div>
        </div>
        <button class="ghost-button" id="inspector-close">关闭</button>
      </div>
      <div class="inspector-tabs" id="inspector-tabs">
        <button class="inspector-tab active" data-inspector-tab="stage">Stage</button>
        <button class="inspector-tab" data-inspector-tab="artifacts">Deliverables</button>
        <button class="inspector-tab" data-inspector-tab="prompts">Prompt Center</button>
        <button class="inspector-tab" data-inspector-tab="system">System State</button>
      </div>
    </div>
    <div class="inspector-body">
      <section class="inspector-pane active" data-inspector-pane="stage">
        <div class="panel-section">
          <div class="panel-title">Stage Chain</div>
          <div class="button-row" style="margin-bottom: 12px;">
            <button class="ghost-button" id="next-stage-btn">推进到下一阶段</button>
            <button class="secondary-button" id="restart-development-btn">开启新研发迭代</button>
          </div>
          <div class="stage-list" id="stage-list"></div>
          <div id="stage-contract" style="margin-top: 14px;"></div>
        </div>
      </section>
      <section class="inspector-pane" data-inspector-pane="artifacts">
        <div class="panel-section">
          <div class="panel-title">Deliverables</div>
          <label class="small-label" for="artifact-type">Artifact Type</label>
          <select id="artifact-type"></select>
          <label class="small-label" for="artifact-title" style="margin-top: 10px;">标题</label>
          <input id="artifact-title" placeholder="artifact 标题">
          <label class="small-label" for="artifact-content" style="margin-top: 10px;">内容</label>
          <textarea id="artifact-content" rows="6" placeholder="artifact 内容"></textarea>
          <div class="button-row" style="margin-top: 12px; margin-bottom: 14px;">
            <button class="secondary-button" id="create-artifact-btn">创建 Artifact</button>
            <button class="ghost-button" id="set-formal-artifact-btn">设为正式交付</button>
          </div>
          <div class="artifact-list" id="artifact-list"></div>
        </div>
      </section>
      <section class="inspector-pane" data-inspector-pane="prompts">
        <div class="panel-section">
          <div class="panel-title">Prompt Library</div>
          <div class="prompt-tools">
            <input id="prompt-search" placeholder="搜索 id / title / target / 内容">
            <select id="prompt-target-filter"></select>
          </div>
          <div class="prompt-workspace">
            <div class="prompt-list" id="prompt-list"></div>
            <div class="prompt-detail" id="prompt-detail"></div>
          </div>
        </div>
      </section>
      <section class="inspector-pane" data-inspector-pane="system">
        <div class="panel-section">
          <div class="panel-title">Bus State</div>
          <div id="dispatch-state-list"></div>
        </div>
      </section>
    </div>
  </aside>
  `;

export function mountUiShell(root) {
  root.innerHTML = uiShellTemplate;
}
