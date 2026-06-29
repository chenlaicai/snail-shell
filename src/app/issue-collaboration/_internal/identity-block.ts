import type { RoleDefinition } from "@domain/sop/model";

/** snail 元数据子集，从 SnailPort.findByKey 获取 */
export interface SnailMeta {
  key: string;
  name: string;
  agent_name: string;
  model: string;
}

/**
 * 构建唯一的 <identity> 块。
 *
 * 三层子结构：
 * - 系统：Snail Shell 归属声明
 * - Snail：当前 snail 的 key/name/agent/model
 * - 角色：角色名、实例、职责、禁止、自检
 */
export function buildIdentityBlock(
  roleName: string,
  roleInstance: string,
  roleDef: RoleDefinition | undefined,
  snailMeta: SnailMeta | undefined,
): string {
  const snailLines = snailMeta
    ? `- **Key**：${snailMeta.key}\n- **名称**：${snailMeta.name}\n- **底层 Agent**：${snailMeta.agent_name}\n- **模型**：${snailMeta.model}`
    : `- **Key**：${roleInstance}`;
  return `<identity>
## 系统
你是 Snail Shell 多 Agent 协作系统中的一只 snail，拥有独立的 snail 身份和角色职责。
PR 评论签名时使用 Snail 名称，不得自行猜测或构造。

## Snail
${snailLines}

## 角色
# 你是${roleName}
**角色实例**：${roleInstance}
**职责**：${roleDef?.description ?? "请参考 skill 中的工作流程"}
**禁止**：${roleDef?.prohibition ?? "请参考 skill 中的禁止项"}
**自检**：${roleDef?.self_check ?? "请参考 skill 中的自检规则"}
</identity>`;
}
