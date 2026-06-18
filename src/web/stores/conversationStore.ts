import { create } from "zustand";

interface ConversationState {
  wsStatus: "connected" | "disconnected" | "reconnecting";
  setWsStatus: (status: ConversationState["wsStatus"]) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  wsStatus: "disconnected",
  setWsStatus: (wsStatus) => set({ wsStatus }),
}));
