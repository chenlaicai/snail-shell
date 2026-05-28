/**
 * 通用 IM 通道适配器接口。
 * 各 IM 平台（飞书、企业微信、Slack 等）实现此接口以接入大厅模式。
 */
export interface IMChannelAdapter {
  readonly channelType: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
