import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { CollaborationConsumer, EvaluationResult, StageTransitionSuggestion } from "@app/issue-collaboration/port";

export class ConsumerNotifier {
  async notifyConsumers(
    consumers: Set<CollaborationConsumer>,
    stageId: string,
    method: keyof CollaborationConsumer,
    args: unknown[]
  ): Promise<void> {
    await Promise.allSettled([...consumers].map(async consumer => {
      await this.invokeConsumerCallback(consumer, stageId, method, args);
    }));
  }

  private async invokeConsumerCallback(consumer: CollaborationConsumer, stageId: string, method: keyof CollaborationConsumer, args: unknown[]): Promise<void> {
    const callback = this.getConsumerCallback(consumer, method);
    if (callback) {
      await callback(stageId, args);
    }
  }

  private getConsumerCallback(consumer: CollaborationConsumer, method: keyof CollaborationConsumer): ((stageId: string, args: unknown[]) => Promise<void>) | null {
    const callbacks: Record<string, ((stageId: string, args: unknown[]) => Promise<void>) | null> = {
      onMessageStarted: consumer.onMessageStarted ? async (stageId, args) => { await consumer.onMessageStarted!(stageId, args[0] as Message); } : null,
      onEvent: consumer.onEvent ? async (stageId, args) => { await consumer.onEvent(stageId, args[0] as MessageEvent); } : null,
      onMessageCompleted: async (stageId, args) => { await consumer.onMessageCompleted(stageId, args[0] as Message, args[1] as MessageContext | null); },
      onUserCalled: async (stageId, args) => { await consumer.onUserCalled(stageId, args[0] as Message); },
      onStageTransitionSuggested: consumer.onStageTransitionSuggested ? async (stageId, args) => { await consumer.onStageTransitionSuggested!(stageId, args[0] as StageTransitionSuggestion); } : null,
      onMergeReady: consumer.onMergeReady ? async (stageId, args) => { await consumer.onMergeReady!(stageId, args[0] as { suggestions: StageTransitionSuggestion[] }); } : null,
      onDisagreement: consumer.onDisagreement ? async (stageId, args) => { await consumer.onDisagreement!(stageId, args[0] as StageTransitionSuggestion); } : null,
      onAutoAdvanced: consumer.onAutoAdvanced ? async (stageId, args) => { await consumer.onAutoAdvanced!(stageId, args[0] as { from: string; to: string; from_key: string; to_key: string; reason: string }); } : null,
      onContextMissing: consumer.onContextMissing ? async (stageId, args) => { await consumer.onContextMissing!(stageId, args[0] as { missing_fields: string[] }); } : null,
      onEvaluationResult: consumer.onEvaluationResult ? async (stageId, args) => { await consumer.onEvaluationResult!(stageId, args[0] as EvaluationResult); } : null
    };
    return callbacks[method] ?? null;
  }
}
