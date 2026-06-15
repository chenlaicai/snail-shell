import type { CollaborationInput } from "@app/issue-collaboration/port";
import type { IMAdapter } from "@domain/im/_internal/adapter";
import type { LobbyAdapter } from "@domain/im/_internal/lobby-adapter";
import { IMHub } from "@app/im-hub/im-hub";

export interface IMHubDeps {
  imAdapter: IMAdapter;
  lobbyAdapter: LobbyAdapter;
  collaboration: CollaborationInput;
}

export function init(deps: IMHubDeps) {
  const adapter = new IMHub(deps);

  for (const config of deps.imAdapter.listChannelConfigs()) {
    const channel = deps.imAdapter.getChannel(config.type);
    channel?.onStageMessage?.(params => adapter.forwardStageMessage({
      channelType: params.channelType,
      chatId: params.chatId,
      tenantKey: params.tenantKey,
      stageId: params.stageId,
      text: params.text,
    }));
  }

  adapter.rehydrateConsumers();
  return { adapter };
}
