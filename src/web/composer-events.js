export function createClientId() {
  const randomPart = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `temp-user-${randomPart}`;
}

export function buildComposerEvents(inputValue, selectedMentions) {
  const mentions = [...selectedMentions].sort((left, right) => left.start - right.start);
  const mentionedSnails = [...new Set(mentions.map((mention) => mention.snail.name))];
  if (!inputValue.trim()) return [];
  return [{
    kind: "text",
    payload: { text: inputValue, mentions: mentionedSnails },
  }];
}
