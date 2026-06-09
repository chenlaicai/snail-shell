import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  composerDraft: string;
  setComposerDraft: (draft: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  composerDraft: "",
  setComposerDraft: (composerDraft) => set({ composerDraft }),
}));
