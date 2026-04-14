import type { SnailName } from "../persistence/store";
import type { ResolvedMention } from "./collaboration";

export function dedupeMentions(mentions: ResolvedMention[]): ResolvedMention[] {
  const seen = new Set<SnailName>();
  return mentions.filter((mention) => {
    if (seen.has(mention.snail)) {
      return false;
    }
    seen.add(mention.snail);
    return true;
  });
}
