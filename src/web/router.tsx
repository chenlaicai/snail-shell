import { createBrowserRouter, type LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "./queries/client";
import { workspaceQueries } from "./queries/workspace.queries";
import { AppShell } from "./layouts/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HomePage } from "./pages/HomePage";
import { WorkspaceBoard } from "./pages/WorkspaceBoard";
import { WorkspaceConfig } from "./pages/WorkspaceConfig";
import { ConversationLayout } from "./pages/ConversationLayout";
import { EvolutionCenter } from "./pages/EvolutionCenter";
import { KnowledgeLibrary } from "./pages/KnowledgeLibrary";
import { SopCenter } from "./pages/SopCenter";
import { SnailDen } from "./pages/SnailDen";
import { PromptCenter } from "./pages/PromptCenter";
import { SkillCenter } from "./pages/SkillCenter";
import { McpCenter } from "./pages/McpCenter";
import { Lobby } from "./pages/Lobby";
import { NotFound } from "./pages/NotFound";

/** 类型安全的 loader 参数提取 */
function requireParams(loaderArgs: LoaderFunctionArgs, ...keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = loaderArgs.params[key];
    if (!value) throw new Response(`Missing param: ${key}`, { status: 400 });
    result[key] = value;
  }
  return result;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <ErrorBoundary />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: "ws/new",
        element: <WorkspaceConfig />,
      },
      {
        path: "ws/:workspaceId",
        element: <WorkspaceBoard />,
        loader: async (args) => {
          const { workspaceId } = requireParams(args, "workspaceId");
          await Promise.all([
            queryClient.ensureQueryData(workspaceQueries.detail(workspaceId)),
            queryClient.ensureQueryData(workspaceQueries.issues(workspaceId)),
          ]);
          return null;
        },
      },
      {
        path: "ws/:workspaceId/issue/:issueId",
        element: <ConversationLayout />,
      },
      { path: "evolution", element: <EvolutionCenter /> },
      { path: "knowledge", element: <KnowledgeLibrary /> },
      { path: "sops", element: <SopCenter /> },
      { path: "snail-den", element: <SnailDen /> },
      { path: "prompts", element: <PromptCenter /> },
      { path: "skills", element: <SkillCenter /> },
      { path: "mcps", element: <McpCenter /> },
      { path: "lobby", element: <Lobby /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
