import { create } from "zustand";

interface CurrentStage {
  id: string;
  type: string;
  status: string;
  stage_definition?: { title?: string };
}

interface CurrentConversation {
  id: string;
  title: string;
  default_role: string;
  participating_roles?: string[];
}

// 只保留纯客户端状态——messages 迁移到 TanStack Query 缓存
interface ConversationState {
  wsStatus: "connected" | "disconnected" | "reconnecting";
  composerDraft: string;
  currentStage: CurrentStage | null;
  currentConversation: CurrentConversation | null;

  setWsStatus: (status: "connected" | "disconnected" | "reconnecting") => void;
  setComposerDraft: (draft: string) => void;
  setCurrentStage: (stage: CurrentStage | null) => void;
  setCurrentConversation: (conv: CurrentConversation | null) => void;
  clear: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  wsStatus: "disconnected",
  composerDraft: "",
  currentStage: null,
  currentConversation: null,

  setWsStatus: (status) => set({ wsStatus: status }),
  setComposerDraft: (draft) => set({ composerDraft: draft }),
  setCurrentStage: (stage) => set({ currentStage: stage }),
  setCurrentConversation: (conv) => set({ currentConversation: conv }),
  clear: () => set({ wsStatus: "disconnected", composerDraft: "", currentStage: null, currentConversation: null }),
}));
