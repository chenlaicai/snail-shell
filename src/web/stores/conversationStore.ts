import { create } from "zustand";
import type { StageDetailDto } from "../types";

/** Store 中保存的 Stage 子集——从 StageDetailDto 提取，自动跟随 DTO 类型演进。 */
type StageDef = NonNullable<StageDetailDto["stage_definition"]>;
type CurrentStage = Pick<StageDetailDto, "id" | "key" | "type" | "title" | "status" | "role_instances" | "active_roles"> & {
  stage_definition?: Pick<StageDef, "key" | "title"> | null;
};

// 只保留纯客户端状态——messages 迁移到 TanStack Query 缓存
interface ConversationState {
  wsStatus: "connected" | "disconnected" | "reconnecting";
  composerDraft: string;
  currentStage: CurrentStage | null;

  setWsStatus: (status: "connected" | "disconnected" | "reconnecting") => void;
  setComposerDraft: (draft: string) => void;
  setCurrentStage: (stage: CurrentStage | null) => void;
  clear: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  wsStatus: "disconnected",
  composerDraft: "",
  currentStage: null,

  setWsStatus: (status) => set({ wsStatus: status }),
  setComposerDraft: (draft) => set({ composerDraft: draft }),
  setCurrentStage: (stage) => set({ currentStage: stage }),
  clear: () => set({ wsStatus: "disconnected", composerDraft: "", currentStage: null }),
}));
