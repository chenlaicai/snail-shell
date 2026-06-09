import { create } from "zustand";
import type { StageDetailDto, ConversationDto } from "../types";

/** Store 中保存的 Stage 子集——从 StageDetailDto 提取，自动跟随 DTO 类型演进。 */
type StageDef = NonNullable<StageDetailDto["stage_definition"]>;
type CurrentStage = Pick<StageDetailDto, "id" | "type" | "status"> & {
  stage_definition?: Pick<StageDef, "key" | "title"> | null;
};

/** Store 中保存的 Conversation 子集。 */
type CurrentConversation = Pick<ConversationDto, "id" | "title" | "default_role"> & {
  participating_roles?: string[];
};

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
