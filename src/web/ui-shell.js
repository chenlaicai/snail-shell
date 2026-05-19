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
          <button class="primary-nav-button" id="nav-snail-den">Snail Den</button>
          <button class="primary-nav-button" id="nav-prompts">Prompt Center</button>
          <button class="primary-nav-button" id="nav-skills">Skill Center</button>
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
              <div class="meta">切换范围后查看候选、治理进度和已沉淀知识</div>
            </div>
            <div class="knowledge-mode-actions">
              <button class="ghost-button" id="knowledge-library-btn">知识库</button>
              <button class="ghost-button" id="knowledge-candidates-btn">待治理</button>
              <button class="ghost-button" id="knowledge-project-btn">当前项目</button>
            </div>
          </div>
          <div id="knowledge-summary"></div>
          <section class="knowledge-directory-list" id="knowledge-list"></section>
        </div>
      </div>
    </aside>

    <main class="main-panel">
      <div class="workspace-main view-pane is-active" id="workspace-main" data-view-pane="projects">
      <div id="project-config-page" class="project-config-page" hidden></div>
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
      <div class="snail-den-panel view-pane" id="snail-den-panel" data-view-pane="snail-den" hidden>
        <div class="snail-den-content" id="snail-den-content"></div>
      </div>
      <div class="prompt-panel view-pane" id="prompt-panel" data-view-pane="prompts" hidden>
        <div class="prompt-center-page" id="prompt-center-page"></div>
      </div>
      <div class="skill-panel view-pane" id="skill-panel" data-view-pane="skills" hidden>
        <div class="skill-center-page" id="skill-center-page"></div>
      </div>
    </main>

    <aside class="context-panel view-related" data-view-related="projects">
      <div class="context-rail">
        <section class="context-card" id="repo-context-summary-section">
          <div class="repo-context-summary-header">
            <div class="context-card-title">Repository Context</div>
            <button class="context-card-link" id="repo-context-edit-btn" type="button">记录</button>
          </div>
          <div class="repo-context-card repo-context-card-inline" id="repo-context-summary-card"></div>
        </section>
        <section class="context-card project-progress-card" id="stage-summary-card"></section>
      </div>
    </aside>

    <aside class="context-panel view-related" data-view-related="prompts" hidden>
      <div class="context-rail">
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Prompt Center</div></div>
          <p class="meta">查看系统提示词的完整组织结构。左侧按 Base / Scenario 层级树形展示，右侧显示选中 prompt 的详情。</p>
        </section>
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Structure</div></div>
          <div class="context-line"><span>Base 层</span><span>始终注入</span></div>
          <div class="context-line"><span>Scenario 层</span><span>条件注入</span></div>
        </section>
      </div>
    </aside>

    <aside class="context-panel view-related" data-view-related="skills" hidden>
      <div class="context-rail">
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Skill Center</div></div>
          <p class="meta">查看系统中已注册的所有 Skill。Skill 是独立的能力包，供系统提示词引用。</p>
        </section>
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Structure</div></div>
          <div class="context-line"><span>Skill 目录</span><span>.meta/skills/</span></div>
          <div class="context-line"><span>入口文件</span><span>SKILL.md</span></div>
        </section>
      </div>
    </aside>

    <aside class="context-panel view-related" data-view-related="knowledge" hidden>
      <div class="context-rail">
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Governance</div></div>
          <div class="context-line"><span>待治理</span><span id="knowledge-pending-count">-</span></div>
          <div class="context-line"><span>当前范围</span><span>Snail Shell</span></div>
          <div class="context-line"><span>流程模型</span><span>governance</span></div>
        </section>
        <section class="context-card">
          <div class="context-card-header"><div class="context-card-title">Governance Flow</div></div>
          <p class="meta">治理操作只在选中具体知识后出现。候选知识需要经过治理对话、查重定性和裁决去向判断，不能在上下文栏伪装成未绑定对象的快捷审批。</p>
        </section>
      </div>
    </aside>
  </div>

  `;

export function mountUiShell(root) {
  root.innerHTML = uiShellTemplate;
}
