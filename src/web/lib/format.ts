export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  const isFuture = diff < 0;
  if (mins < 1) return "just now";
  if (mins < 60) return isFuture ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isFuture ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return isFuture ? `in ${days}d` : `${days}d ago`;
  return isFuture ? `in ${Math.floor(days / 7)}w` : `${Math.floor(days / 7)}w ago`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
