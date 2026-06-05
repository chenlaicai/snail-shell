import { create } from "zustand";

interface Message {
  id: number;
  role: string;
  from_role?: string;
  content?: string;
  created_at: string;
  status?: string;
  events?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface Stage {
  id: string;
  type: string;
  status: string;
  stage_definition?: { title?: string };
}

interface Conversation {
  id: string;
  title: string;
  default_role: string;
}

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
  updateMessage: (id: string, updates: Partial<Message>) => void;
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
