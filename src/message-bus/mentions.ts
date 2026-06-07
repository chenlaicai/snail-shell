import type { RoleName } from "../shared/types";
import type { ResolvedMention } from "./collaboration";

export function dedupeMentions(mentions: ResolvedMention[]): ResolvedMention[] {
  const seen = new Set<RoleName>();
  return mentions.filter((mention) => {
    if (seen.has(mention.roleName)) {
      return false;
    }
    seen.add(mention.roleName);
    return true;
  });
}
