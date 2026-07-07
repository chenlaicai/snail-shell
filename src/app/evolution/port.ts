import type { EvolutionItem } from "@domain/evolution/model";

/** Evolution App 层端口定义（编排逻辑） */
export interface EvolutionAppPort {
  /** 基于 item 创建 issue（Candidate → InProgress） */
  createIssueFromItem(itemId: string): Promise<EvolutionItem>;

  /** 关闭条目（Candidate → Completed，不走治理流程） */
  closeItem(itemId: string, result?: string): Promise<EvolutionItem>;
}
