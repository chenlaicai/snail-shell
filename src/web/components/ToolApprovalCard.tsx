import { useState } from "react";
import { useApproveTool } from "@/mutations/conversation.mutations";
import type { ToolPermissionRequest } from "@/types";

interface ToolApprovalCardProps {
  conversationId: string;
  messageId: number;
  request: ToolPermissionRequest;
  onDecide?: () => void;
}

export function ToolApprovalCard({ conversationId, messageId, request, onDecide }: ToolApprovalCardProps) {
  const [decided, setDecided] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approveTool = useApproveTool(conversationId, messageId);

  const handleDecision = (approved: boolean) => {
    setError(null);
    approveTool.mutate({ approved }, {
      onSuccess: () => { setDecided(true); onDecide?.(); },
      onError: (err) => { setError(err instanceof Error ? err.message : "Request failed"); },
    });
  };

  if (decided) return null;

  return (
    <div className="bg-surface-3 border border-status-amber/30 rounded-lg p-4 my-2" role="alert" aria-label="Tool permission request">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-status-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <span className="text-[13px] font-medium text-status-amber">Tool Permission Request</span>
      </div>
      <div className="mb-3">
        <p className="text-[13px] text-text-primary">
          Agent wants to use <span className="font-mono text-shell-400">{request.tool_name}</span>
        </p>
        {request.tool_input && Object.keys(request.tool_input).length > 0 && (
          <pre className="mt-2 bg-surface-0 rounded p-2 text-[11px] text-text-secondary overflow-x-auto">
            {JSON.stringify(request.tool_input, null, 2)}
          </pre>
        )}
      </div>
      {error && (
        <div className="mb-2 text-[12px] text-status-red">{error}</div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleDecision(true)}
          disabled={approveTool.isPending}
          aria-label={`Approve ${request.tool_name}`}
          className="px-3 py-1.5 rounded-md bg-status-green/20 hover:bg-status-green/30 text-status-green text-xs font-medium transition-colors disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => handleDecision(false)}
          disabled={approveTool.isPending}
          aria-label={`Deny ${request.tool_name}`}
          className="px-3 py-1.5 rounded-md bg-status-red/20 hover:bg-status-red/30 text-status-red text-xs font-medium transition-colors disabled:opacity-50"
        >
          Deny
        </button>
        {approveTool.isPending && <span className="text-[11px] text-text-muted">Processing...</span>}
      </div>
    </div>
  );
}
