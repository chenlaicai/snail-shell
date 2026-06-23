export type * from "@api-contracts/dto";

export interface ToastMessage { id: number; message: string; isError: boolean }
export interface Role { name: string; description?: string }
export interface RuntimeUsage { label: string; percentLabel: string; title: string; isPlaceholder: boolean }
export interface Participant { name: string; roleDef?: { name: string; description?: string; snail_template_id?: string } | null; isPrimary: boolean }
export interface RoleDefinition { key?: string; name: string; description?: string; snail_template_id?: string; is_primary?: boolean; count?: number; skill?: string | null; prohibition?: string | null; self_check?: string | null }
export interface ConversationSource { id: string; title: string }
