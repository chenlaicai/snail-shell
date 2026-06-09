import type { ReactNode } from "react";

interface QueryStateProps<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}

export function QueryState<T>({ data, isLoading, error, children, skeleton }: QueryStateProps<T>) {
  if (isLoading) return <>{skeleton ?? <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>}</>;
  if (error) return <div className="flex items-center justify-center h-full text-[var(--color-danger-text)] text-[13px]">加载失败：{error.message}</div>;
  if (data === undefined || data === null) return null;
  return <>{children(data)}</>;
}
