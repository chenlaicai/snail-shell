import { createBrowserRouter, redirect, type LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "./queries/client";
import { workspaceQueries, issueQueries } from "./queries/workspace.queries";
import { sopQueries } from "./queries/sop.queries";
import { evolutionQueries } from "./queries/evolution.queries";
import { knowledgeQueries } from "./queries/knowledge.queries";
import { metaQueries } from "./queries/meta.queries";
import { recordPageLoad } from "./lib/perf-logger";
import { AppShell } from "./layouts/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HomePage } from "./pages/HomePage";
import { WorkspaceDirectory } from "./pages/WorkspaceDirectory";
import { WorkspaceConfig } from "./pages/WorkspaceConfig";
import { IssueBoard } from "./pages/IssueBoard";
import { IssueList } from "./pages/IssueList";
import { IssueConversation } from "./pages/IssueConversation";
import { EvolutionCenter } from "./pages/EvolutionCenter";
import { KnowledgeLibrary } from "./pages/KnowledgeLibrary";
import { SopCenter } from "./pages/SopCenter";
import { SnailDen } from "./pages/SnailDen";
import { PromptCenter } from "./pages/PromptCenter";
import { SkillCenter } from "./pages/SkillCenter";
import { McpServers } from "./pages/McpServers";
import { McpConfig } from "./pages/McpConfig";
import { Lobby } from "./pages/Lobby";
import { NotFound } from "./pages/NotFound";

function requireParams(loaderArgs: LoaderFunctionArgs, ...keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = loaderArgs.params[key];
    if (!value) throw new Response(`Missing param: ${key}`, { status: 400 });
    result[key] = value;
  }
  return result;
}

/** 包装路由 loader，记录耗时并超阈值上报 */
function timedLoader(path: string, fn: (args: LoaderFunctionArgs) => Promise<unknown>) {
  return async (args: LoaderFunctionArgs) => {
    const start = performance.now();
    try {
      return await fn(args);
    } finally {
      recordPageLoad(path, performance.now() - start);
    }
  };
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <ErrorBoundary><div /></ErrorBoundary>,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: "workspaces",
        element: <WorkspaceDirectory />,
        loader: timedLoader("/workspaces", async () => {
          await queryClient.ensureQueryData(workspaceQueries.list());
          return null;
        }),
      },
      {
        path: "workspaces/new",
        element: <WorkspaceConfig />,
      },
      {
        path: "workspaces/:workspaceId",
        loader: (args) => redirect(`/workspaces/${args.params.workspaceId}/board`),
      },
      {
        path: "workspaces/:workspaceId/board",
        element: <IssueBoard />,
        loader: timedLoader("/workspaces/:workspaceId/board", async (args) => {
          const { workspaceId } = requireParams(args, "workspaceId");
          await Promise.all([
            queryClient.ensureQueryData(workspaceQueries.detail(workspaceId)),
            queryClient.ensureQueryData(workspaceQueries.issues(workspaceId)),
          ]);
          return null;
        }),
      },
      {
        path: "workspaces/:workspaceId/list",
        element: <IssueList />,
        loader: timedLoader("/workspaces/:workspaceId/list", async (args) => {
          const { workspaceId } = requireParams(args, "workspaceId");
          await Promise.all([
            queryClient.ensureQueryData(workspaceQueries.detail(workspaceId)),
            queryClient.ensureQueryData(workspaceQueries.issues(workspaceId)),
          ]);
          return null;
        }),
      },
      {
        path: "workspaces/:workspaceId/issue/:issueId",
        element: <IssueConversation />,
        loader: timedLoader("/workspaces/:workspaceId/issue/:issueId", async (args) => {
          const { issueId } = requireParams(args, "issueId");
          await queryClient.ensureQueryData(issueQueries.detail(issueId));
          return null;
        }),
      },
      {
        path: "evolution",
        element: <EvolutionCenter />,
        loader: timedLoader("/evolution", async () => {
          await queryClient.ensureQueryData(evolutionQueries.list());
          return null;
        }),
      },
      {
        path: "knowledge",
        element: <KnowledgeLibrary />,
        loader: timedLoader("/knowledge", async () => {
          await queryClient.ensureQueryData(knowledgeQueries.list());
          return null;
        }),
      },
      {
        path: "sops",
        element: <SopCenter />,
        loader: timedLoader("/sops", async () => {
          await queryClient.ensureQueryData(sopQueries.list());
          return null;
        }),
      },
      {
        path: "snail-den",
        element: <SnailDen />,
        loader: timedLoader("/snail-den", async () => {
          await queryClient.ensureQueryData(metaQueries.snailDen());
          return null;
        }),
      },
      {
        path: "prompts",
        element: <PromptCenter />,
        loader: timedLoader("/prompts", async () => {
          await queryClient.ensureQueryData(metaQueries.prompts());
          return null;
        }),
      },
      {
        path: "skills",
        element: <SkillCenter />,
        loader: timedLoader("/skills", async () => {
          await queryClient.ensureQueryData(metaQueries.skills());
          return null;
        }),
      },
      {
        path: "mcps",
        loader: () => redirect("/mcp-config", { replace: true }),
      },
      {
        path: "mcp-servers",
        element: <McpServers />,
        loader: timedLoader("/mcp-servers", async () => {
          await queryClient.ensureQueryData(metaQueries.mcpServers());
          return null;
        }),
      },
      {
        path: "mcp-config",
        element: <McpConfig />,
        loader: timedLoader("/mcp-config", async () => {
          await queryClient.ensureQueryData(metaQueries.mcpConfigs());
          return null;
        }),
      },
      {
        path: "lobby",
        element: <Lobby />,
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
