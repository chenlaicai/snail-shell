import type { UseQueryResult } from "@tanstack/react-query";

interface QueryStateProps {
  query: UseQueryResult;
  loadingText?: string;
  errorText?: string;
  emptyText?: string;
  isEmpty?: boolean;
  children: React.ReactNode;
}

export function QueryState({ query, loadingText = "Loading...", errorText, emptyText = "No data", isEmpty, children }: QueryStateProps) {
  if (query.isLoading) {
    return <div className="text-center text-text-muted text-sm py-16">{loadingText}</div>;
  }

  if (query.isError) {
    const msg = errorText ?? (query.error instanceof Error ? query.error.message : "Failed to load data");
    return (
      <div className="text-center py-16">
        <p className="text-[13px] text-status-red mb-2">{msg}</p>
        <button
          onClick={() => query.refetch()}
          className="text-[12px] text-text-secondary hover:text-text-primary underline transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (query.data === undefined || query.data === null) {
    return <div className="text-center text-text-muted text-sm py-16">{emptyText}</div>;
  }

  if (isEmpty ?? (Array.isArray(query.data) && query.data.length === 0)) {
    return <div className="text-center text-text-muted text-sm py-16">{emptyText}</div>;
  }

  return <>{children}</>;
}
