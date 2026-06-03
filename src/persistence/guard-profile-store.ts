/**
 * GuardProfileStore — 从 config/guard-profile.json 加载安全策略配置。
 *
 * Why: 原先 guard-config.ts 直接读取文件，违反持久化层统一入口原则。
 * 提取为独立 Store 后，所有配置文件读写都经过 persistence 层。
 */
import fs from "fs";
import path from "path";
import { logger } from "../logger";

/** GuardProfile 类型定义——从 agent/capability/spec.ts 迁移。 */
export interface GuardProfile {
  /** 放行列表：匹配的工具调用直接放行，不触发审批 */
  allow: string[];
  /** 拒绝列表：匹配的工具调用直接拒绝（优先于 allow） */
  deny: string[];
}

export class GuardProfileStore {
  private readonly configPath: string;
  private cachedProfile: GuardProfile | null = null;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, "guard-profile.json");
  }

  /**
   * 获取系统默认 GuardProfile。
   * 文件缺失/不可解析 → 直接抛错。
   * 字段级非法值 → 回退空数组 + 日志告警。
   */
  getDefaultProfile(): GuardProfile {
    if (this.cachedProfile) return this.cachedProfile;

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
    } catch (err: unknown) {
      throw new Error(`无法加载 config/guard-profile.json: ${(err as Error).message}`, { cause: err });
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("config/guard-profile.json 内容不是有效的 JSON 对象");
    }
    const src = parsed as Record<string, unknown>;

    const allow = Array.isArray(src["allow"])
      ? (src["allow"] as unknown[]).filter((e): e is string => typeof e === "string")
      : [];
    const deny = Array.isArray(src["deny"])
      ? (src["deny"] as unknown[]).filter((e): e is string => typeof e === "string")
      : [];

    if (!Array.isArray(src["allow"])) logger.warn("GuardProfile.allow 不是数组 → 回退空数组");
    if (!Array.isArray(src["deny"])) logger.warn("GuardProfile.deny 不是数组 → 回退空数组");

    this.cachedProfile = { allow, deny };
    return this.cachedProfile;
  }
}
