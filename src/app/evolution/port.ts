import type { EvolutionItem } from "@domain/evolution/model";

/** Evolution App 层端口定义（编排逻辑） */
export interface EvolutionAppPort {
  /** 基于 item 创建 issue（Candidate → InProgress） */
  createIssueFromItem(itemId: string): Promise<EvolutionItem>;
}
