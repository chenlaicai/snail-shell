import { create } from "zustand";
import type { MessageWithEvents, Stage, Conversation } from "../../shared/domain-types";

// 使用 shared 实体类型替代局部 interface
// Step 4 将进一步缩减：messages/currentStage/currentConversation 迁移到 TanStack Query
type Message = MessageWithEvents;

interface ConversationState {
  messages: Message[];
  currentStage: Stage | null;
  currentConversation: Conversation | null;
  wsStatus: "connected" | "disconnected" | "reconnecting";

  setCurrentStage: (stage: Stage | null) => void;
  setCurrentConversation: (conv: Conversation | null) => void;
  setWsStatus: (status: "connected" | "disconnected" | "reconnecting") => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  appendMessage: (message: Message) => void;
  appendMessages: (messages: Message[]) => void;
  updateMessage: (id: number, updates: Partial<Message>) => void;
  clear: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  messages: [],
  currentStage: null,
  currentConversation: null,
  wsStatus: "disconnected",

  setCurrentStage: (stage) => set({ currentStage: stage }),
  setCurrentConversation: (conv) => set({ currentConversation: conv }),
  setWsStatus: (status) => set({ wsStatus: status }),
  setMessages: (messagesOrFn) => set((state) => ({
    messages: typeof messagesOrFn === "function" ? messagesOrFn(state.messages) : messagesOrFn,
  })),
  appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendMessages: (newMessages) => set((state) => ({ messages: [...newMessages, ...state.messages] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  clear: () => set({ messages: [], currentStage: null, currentConversation: null, wsStatus: "disconnected" }),
}));
