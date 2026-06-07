/**
 * GuardProfileStore — 从 config/guard-profile.json 加载安全策略配置。
 */
import { logger } from "../logger";
import type { GuardProfile } from "../shared/types";
import { JsonConfigStore } from "./json-config-store";

export type { GuardProfile };

function parseGuardProfile(raw: string): GuardProfile {
  const parsed: unknown = JSON.parse(raw);
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
  return { allow, deny };
}

export class GuardProfileStore {
  private readonly store: JsonConfigStore<GuardProfile>;

  constructor(configDir: string) {
    this.store = new JsonConfigStore(configDir, "guard-profile.json", { allow: [], deny: [] }, parseGuardProfile);
  }

  getDefaultProfile(): GuardProfile {
    return this.store.get();
  }
}
