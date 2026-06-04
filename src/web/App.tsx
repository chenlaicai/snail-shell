import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { HomePage } from "./pages/HomePage";
import { WorkspaceBoard } from "./pages/WorkspaceBoard";
import { ConversationLayout } from "./pages/ConversationLayout";
import { EvolutionCenter } from "./pages/EvolutionCenter";
import { KnowledgeLibrary } from "./pages/KnowledgeLibrary";
import { SnailDen } from "./pages/SnailDen";
import { PromptCenter } from "./pages/PromptCenter";
import { SkillCenter } from "./pages/SkillCenter";
import { McpCenter } from "./pages/McpCenter";
import { Lobby } from "./pages/Lobby";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/ws/:workspaceId" element={<WorkspaceBoard />} />
          <Route path="/ws/:workspaceId/issue/:issueId" element={<ConversationLayout />} />
          <Route path="/evolution" element={<EvolutionCenter />} />
          <Route path="/knowledge" element={<KnowledgeLibrary />} />
          <Route path="/snail-den" element={<SnailDen />} />
          <Route path="/prompts" element={<PromptCenter />} />
          <Route path="/skills" element={<SkillCenter />} />
          <Route path="/mcps" element={<McpCenter />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="*" element={<div className="empty-state">页面不存在</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
