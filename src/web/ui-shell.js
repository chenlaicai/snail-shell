const uiShellTemplate = `  <div id="app-notice" style="display:none; padding:10px 20px; background:#1d4ed8; color:white; font-size:13px;"></div>
  <div class="app-shell">
    <aside class="sidebar">
      <header class="brand-bar">
        <div class="brand-mark">S</div>
        <div class="brand-title"><span>Snail</span> Shell</div>
      </header>

      <section class="directory-switcher" id="directory-switcher">
        <button type="button" class="directory-summary" id="directory-toggle">
          <span>
            <span class="directory-title">一级目录</span>
            <span class="directory-hint">低频入口，可收纳</span>
          </span>
          <span class="directory-chevron" id="directory-chevron">▴</span>
        </button>
        <div class="primary-nav" id="primary-nav">
          <button class="primary-nav-button active" id="nav-projects" aria-current="page">项目管理</button>
          <button class="primary-nav-button" id="nav-knowledge">知识中心</button>
        </div>
      </section>

      <div class="sidebar-main">
        <div class="view-related workspace-tree" data-view-related="projects">
          <div id="project-summary-card" hidden></div>
          <div class="tree-toolbar">
            <div class="panel-title">Workspace Tree</div>
            <div class="button-row"><button class="primary-button" id="new-project-btn">新建</button></div>
          </div>
          <section class="tree-card">
            <div class="tree-project-list" id="project-list"></div>
          </section>
        </div>

        <div class="view-related workspace-tree" data-view-related="knowledge" hidden>
          <div class="tree-toolbar">
            <div>
              <div class="panel-title">Knowledge Directory</div>
              <div class="meta">切换范围后在下方选择知识条目</div>
            </div>
            <div class="knowledge-mode-actions">
              <button class="ghost-button" id="knowledge-library-btn">知识库</button>
              <button class="ghost-button" id="knowledge-candidates-btn">待审批</button>
              <button class="ghost-button" id="knowledge-project-btn">当前项目</button>
            </div>
          </div>
          <div id="knowledge-summary"></div>
          <section class="knowledge-directory-list" id="knowledge-list"></section>
        </div>
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
      <div id="boss-mentions-banner" class="boss-mentions-banner"></div>

      <div id="messages"></div>

      <div class="composer">
        <div id="reply-banner" class="reply-banner">
          <div id="reply-banner-text"></div>
          <button type="button" id="reply-cancel" class="reply-cancel">取消</button>
        </div>
        <div class="composer-input-stack">
          <textarea id="input" placeholder="输入 @Design Snail 与指定 snail 对话；未指定时默认发送给当前主 snail" rows="2"></textarea>
          <div class="composer-hints">
            <div id="mention-status" class="mention-status"></div>
            <div id="mention-suggestions" class="mention-suggestions"></div>
          </div>
        </div>
        <div class="composer-actions button-row">
          <button class="primary-button" id="send-btn">发送</button>
          <button class="danger-button" id="interrupt-btn" type="button" hidden>中断 Snail</button>
        </div>
      </div>
      </div>
      <div class="knowledge-panel view-pane" id="knowledge-panel" data-view-pane="knowledge" hidden>
        <div class="knowledge-detail" id="knowledge-detail"></div>
      </div>
    </main>

    <aside class="context-panel view-related" data-view-related="projects">
      <div class="context-rail">
        <section class="context-card" id="repo-context-summary-section">
          <div class="repo-context-summary-header">
            <div class="context-card-title">Repository Context</div>
            <button class="context-card-link" data-inspector-open="stage">记录</button>
          </div>
          <div class="repo-context-card repo-context-card-inline" id="repo-context-summary-card">
            <div class="meta">选择 Feature 后记录分支、worktree 和 PR，用于完成后安全清理。</div>
          </div>
        </section>
        <section class="context-card" id="stage-summary-card"></section>
        <section class="context-card" id="participants-summary-card"></section>
        <section class="context-card" id="deliverables-summary-card"></section>
      </div>
    </aside>

    <aside class="context-panel view-related" data-view-related="knowledge" hidden>
      <div class="context-rail">
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Governance</div></div>
          <div class="context-line"><span>待审批</span><span id="knowledge-pending-count">-</span></div>
          <div class="context-line"><span>当前范围</span><span>Snail Shell</span></div>
          <div class="context-line"><span>治理级别</span><span>approval</span></div>
        </section>
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Review Flow</div></div>
          <p class="meta">审批、拒绝、废弃和来源查看只在选中知识详情后出现，避免右侧上下文栏暴露未绑定具体知识的伪操作。</p>
        </section>
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
          <div class="panel-title">Repository Context</div>
          <div class="repo-context-card" id="repo-context-card">
            <div class="meta">选择 Feature 后记录分支、worktree 和 PR，用于完成后安全清理。</div>
          </div>
          <div class="button-row" style="margin-top: 12px; margin-bottom: 14px;">
            <button class="ghost-button" id="repo-context-edit-btn">记录仓库上下文</button>
          </div>
        </div>
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
