import { create } from "zustand";

// 只保留纯客户端状态——messages 迁移到 TanStack Query 缓存
interface ConversationState {
  wsStatus: "connected" | "disconnected" | "reconnecting";
  composerDraft: string;

  setWsStatus: (status: "connected" | "disconnected" | "reconnecting") => void;
  setComposerDraft: (draft: string) => void;
  clear: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  wsStatus: "disconnected",
  composerDraft: "",

  setWsStatus: (status) => set({ wsStatus: status }),
  setComposerDraft: (draft) => set({ composerDraft: draft }),
  clear: () => set({ wsStatus: "disconnected", composerDraft: "" }),
}));
