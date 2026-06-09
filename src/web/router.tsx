import { createBrowserRouter, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { workspaceQueries } from "./queries/workspace.queries";
import { AppShell } from "./layouts/AppShell";
import { IssueBoard } from "./pages/IssueBoard";
import { IssueList } from "./pages/IssueList";
import { IssueConversation } from "./pages/IssueConversation";
import { EvolutionCenter } from "./pages/EvolutionCenter";
import { KnowledgeLibrary } from "./pages/KnowledgeLibrary";
import { SopCenter } from "./pages/SopCenter";
import { Lobby } from "./pages/Lobby";
import { PromptCenter, SkillCenter, SnailDen, McpCenter } from "./pages/MetaPages";

function WorkspaceRedirect() {
  const { data: workspaces, isLoading } = useQuery(workspaceQueries.list());
  if (isLoading) return <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading...</div>;
  const first = workspaces?.[0];
  if (!first) return <div className="flex items-center justify-center h-full text-text-muted text-sm">No workspaces found</div>;
  return <Navigate to={`/ws/${first.id}/board`} replace />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <WorkspaceRedirect /> },
      { path: "ws/:workspaceId/board", element: <IssueBoard /> },
      { path: "ws/:workspaceId/list", element: <IssueList /> },
      { path: "ws/:workspaceId/issue/:issueId", element: <IssueConversation /> },
      { path: "evolution", element: <EvolutionCenter /> },
      { path: "knowledge", element: <KnowledgeLibrary /> },
      { path: "sops", element: <SopCenter /> },
      { path: "lobby", element: <Lobby /> },
      { path: "prompts", element: <PromptCenter /> },
      { path: "skills", element: <SkillCenter /> },
      { path: "snail-den", element: <SnailDen /> },
      { path: "mcps", element: <McpCenter /> },
      { path: "*", element: <WorkspaceRedirect /> },
    ],
  },
]);
