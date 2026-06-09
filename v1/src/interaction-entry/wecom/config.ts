import path from "path";

import { WecomConfigStore, type WecomConfig } from "../../persistence/wecom-config-store";

/** 从 config/wecom.json 加载企业微信配置，配置文件不存在时返回默认配置（enabled: false）。 */
export function loadWecomConfig(configDir = path.join(process.cwd(), "config")): WecomConfig {
  return new WecomConfigStore(configDir).getConfig();
}
