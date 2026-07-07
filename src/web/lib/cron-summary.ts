import { CronExpressionParser } from "cron-parser";

const CRON_LABELS: Record<string, string> = {
  "0 9 * * *": "每天 9:00",
  "0 9 * * 1": "每周一 9:00",
  "0 9 1 * *": "每月 1 号 9:00",
};

/** 将 cron 表达式转换为人类可读摘要 */
export function cronSummary(expr: string): string {
  if (CRON_LABELS[expr]) return CRON_LABELS[expr];
  try {
    const interval = CronExpressionParser.parse(expr);
    const next = interval.next().toDate();
    return `下次: ${next.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return expr;
  }
}
