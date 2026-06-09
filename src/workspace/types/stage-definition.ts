/**
 * 工作区级 Stage 定义类型
 *
 * 定义工作区级 Stage 配置和角色定义。
 */

import type { StageChecklistItem } from "../../sop";

/** 工作区级 Stage 定义，描述一个 Stage 的配置。 */
export interface WorkspaceStageDefinition {
  /** 唯一标识。 */
  id: string;
  /** 所属 SOP ID。 */
  sop_id: string;
  /** 所属工作区 ID。 */
  workspace_id: string;
  /** Stage 标识符，如 development、review。 */
  key: string;
  /** 显示名称。 */
  title: string;
  /** 排序序号。 */
  sequence: number;
  /** 输入要求描述。 */
  input_description: string | null;
  /** 产出要求描述。 */
  output_description: string | null;
  /** 验收要点，JSON 字符串数组。 */
  acceptance_focus: string[];
  /** 阶段验收清单。每项包含 id、description、required。 */
  acceptance_checklist: StageChecklistItem[];
  /** 创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/** Stage 内角色定义。 */
export interface StageRoleDefinition {
  /** 唯一标识。 */
  id: string;
  /** 所属 Stage 定义 ID。 */
  stage_definition_id: string;
  /** 角色标识符，如 developer、reviewer。 */
  key: string;
  /** 角色显示名，用于 conversation/message 路由。 */
  name: string;
  /** 引用的 snail den template ID，来自 issue.role_snail_mapping 运行时绑定。 */
  snail_template_id: string | null;
  /** 是否为该 Stage 的主角色。 */
  is_primary: number;
  /** 该角色在本 Stage 的实例数（如 count=2 展开为 "审查者-1"、"审查者-2"）。 */
  count: number;
  /** 角色描述。 */
  description: string;
  /** 角色手册，包含工作规则和手册内容，从 SOP YAML 的 handbook 字段内联加载。 */
  handbook: string | null;
}
