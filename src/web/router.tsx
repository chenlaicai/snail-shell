import { createBrowserRouter, type LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "./queries/client";
import { workspaceQueries } from "./queries/workspace.queries";
import { conversationQueries } from "./queries/conversation.queries";
import { sopQueries } from "./queries/sop.queries";
import { evolutionQueries } from "./queries/evolution.queries";
import { knowledgeQueries } from "./queries/knowledge.queries";
import { lobbyQueries } from "./queries/lobby.queries";
import { metaQueries } from "./queries/meta.queries";
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
        loader: async () => {
          await queryClient.ensureQueryData(sopQueries.list());
          return null;
        },
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
        loader: async (args) => {
          const { issueId } = requireParams(args, "issueId");
          await queryClient.ensureQueryData(conversationQueries.messages(issueId));
          return null;
        },
      },
      {
        path: "evolution",
        element: <EvolutionCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(evolutionQueries.list());
          return null;
        },
      },
      {
        path: "knowledge",
        element: <KnowledgeLibrary />,
        loader: async () => {
          await queryClient.ensureQueryData(knowledgeQueries.list());
          return null;
        },
      },
      {
        path: "sops",
        element: <SopCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(sopQueries.list());
          return null;
        },
      },
      {
        path: "snail-den",
        element: <SnailDen />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.snailDen());
          return null;
        },
      },
      {
        path: "prompts",
        element: <PromptCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.prompts());
          return null;
        },
      },
      {
        path: "skills",
        element: <SkillCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.skills());
          return null;
        },
      },
      {
        path: "mcps",
        element: <McpCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.mcps());
          return null;
        },
      },
      {
        path: "lobby",
        element: <Lobby />,
        loader: async () => {
          await queryClient.ensureQueryData(lobbyQueries.sessions());
          return null;
        },
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
