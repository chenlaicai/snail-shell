/**
 * 飞书类型已提取为通用接口到 im-channel/types.ts。
 * 此文件保留 re-export 以保持向后兼容，避免外部 import 路径断裂。
 */
export type { IMInboundMessage as FeishuInboundMessage, IMTransport as FeishuTransport } from "../im-channel/types";
