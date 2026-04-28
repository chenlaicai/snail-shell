function compareMessageOrder(left, right) {
  const leftTime = Date.parse(left.created_at || "") || 0;
  const rightTime = Date.parse(right.created_at || "") || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftId = Number.isInteger(left.id) ? left.id : Number.MAX_SAFE_INTEGER;
  const rightId = Number.isInteger(right.id) ? right.id : Number.MAX_SAFE_INTEGER;
  if (leftId !== rightId) return leftId - rightId;
  return String(left.key).localeCompare(String(right.key));
}

function cloneEvents(events) {
  return Array.isArray(events) ? events.map((event) => ({ ...event, payload: event?.payload ? { ...event.payload } : event.payload, source: event?.source ? { ...event.source } : event.source })) : [];
}

function firstContentText(record) {
  return (record.events || []).map((event) => {
    if (event.kind === "text") return event.payload?.text || "";
    if (event.kind === "content_block") return event.payload?.fallback_text || "";
    return "";
  }).find((text) => text.trim()) || "";
}

function matchOptimisticToPersisted(optimistic, persisted) {
  if (!optimistic || !persisted) return false;
  if (optimistic.role !== persisted.role) return false;
  if ((optimistic.from_snail || null) !== (persisted.from_snail || null)) return false;
  if ((optimistic.quoted_message_id || null) !== (persisted.quoted_message_id || null)) return false;
  const optimisticText = firstContentText(optimistic).trim();
  const persistedText = firstContentText(persisted).trim();
  if (!optimisticText || optimisticText !== persistedText) return false;
  const optimisticTime = Date.parse(optimistic.created_at || "") || 0;
  const persistedTime = Date.parse(persisted.created_at || "") || 0;
  return Math.abs(optimisticTime - persistedTime) < 60 * 1000;
}

function deriveStatus(record) {
  if (record.localError || record.status === "failed") return "error";
  if (record.status === "completed") return "done";
  if (record.status === "cancelled" || record.status === "interrupted") return record.status;
  if ((record.events || []).some((event) => event.category === "content")) return "streaming";
  if ((record.events || []).some((event) => event.kind === "start")) return "thinking";
  return record.optimistic ? "pending" : "idle";
}

function createRecordFromPersisted(message) {
  return {
    key: `message:${message.id}`,
    id: message.id,
    clientId: null,
    role: message.role,
    from_snail: message.from_snail || null,
    quoted_message_id: message.quoted_message_id || null,
    quoted_message: message.quoted_message || null,
    created_at: message.created_at,
    status: message.status || "completed",
    events: cloneEvents(message.events || []),
    optimistic: false,
    localError: null,
  };
}

function createRecordFromRealtime(event) {
  return {
    key: `message:${event.message_id}`,
    id: event.message_id,
    clientId: event.client_id || null,
    role: event.role || "assistant",
    from_snail: event.snail_name || null,
    quoted_message_id: null,
    quoted_message: null,
    created_at: new Date().toISOString(),
    status: event.status || "streaming",
    events: [],
    optimistic: false,
    localError: null,
  };
}

function createRecordFromOptimistic(input) {
  return {
    key: `optimistic:${input.clientId}`,
    id: null,
    clientId: input.clientId,
    role: input.role,
    from_snail: input.from_snail || null,
    quoted_message_id: input.quoted_message_id || null,
    quoted_message: input.quoted_message || null,
    created_at: input.created_at,
    status: "streaming",
    events: cloneEvents(input.events || []),
    optimistic: true,
    localError: null,
  };
}

function createStoreState() {
  return { records: [], byKey: new Map(), byPersistedId: new Map() };
}

export function createMessageStore(onChange) {
  let state = createStoreState();

  function rebuildIndexes(records) {
    const byKey = new Map();
    const byPersistedId = new Map();
    records.forEach((record) => {
      record.statusView = deriveStatus(record);
      byKey.set(record.key, record);
      if (Number.isInteger(record.id)) byPersistedId.set(record.id, record);
    });
    state = { records: records.slice().sort(compareMessageOrder), byKey, byPersistedId };
    onChange?.(getState());
  }

  function getState() {
    return { records: state.records.slice(), byPersistedId: new Map(state.byPersistedId) };
  }

  function reset() { rebuildIndexes([]); }

  function replaceHistory(messages) {
    const persistedRecords = (Array.isArray(messages) ? messages : []).map(createRecordFromPersisted);
    const matchedOptimisticKeys = new Set();
    persistedRecords.forEach((persisted) => {
      const match = state.records.find((record) => record.optimistic && !matchedOptimisticKeys.has(record.key) && matchOptimisticToPersisted(record, persisted));
      if (match) matchedOptimisticKeys.add(match.key);
    });
    const unmatchedOptimistic = state.records.filter((record) => record.optimistic && !matchedOptimisticKeys.has(record.key));
    rebuildIndexes([...persistedRecords, ...unmatchedOptimistic]);
  }

  function addOptimisticMessage(input) {
    const record = createRecordFromOptimistic(input);
    rebuildIndexes([...state.records, record]);
    return record;
  }

  function findOptimisticByClientId(clientId) {
    return clientId ? state.byKey.get(`optimistic:${clientId}`) || null : null;
  }

  function ensureRealtimeRecord(event) {
    const existing = state.byPersistedId.get(event.message_id);
    if (existing) return existing;
    const optimistic = findOptimisticByClientId(event.client_id);
    if (optimistic) {
      const upgraded = { ...optimistic, key: `message:${event.message_id}`, id: event.message_id, clientId: event.client_id || optimistic.clientId || null, optimistic: false, localError: null };
      rebuildIndexes(state.records.map((record) => record.key === optimistic.key ? upgraded : record));
      return state.byPersistedId.get(event.message_id);
    }
    const record = createRecordFromRealtime(event);
    rebuildIndexes([...state.records, record]);
    return state.byPersistedId.get(event.message_id);
  }

  function applyRealtimeStart(event) {
    const current = ensureRealtimeRecord(event);
    const next = { ...current, role: event.role || current.role, from_snail: event.snail_name || current.from_snail, status: event.status || current.status };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimeEvent(event) {
    const current = ensureRealtimeRecord({ ...event, role: "assistant", status: "streaming" });
    const nextEvents = cloneEvents(current.events).filter((item) => !(event.event && item.id === event.event.id));
    if (event.event) nextEvents.push({ ...event.event, payload: event.event.payload ? { ...event.event.payload } : event.event.payload });
    const next = { ...current, from_snail: event.snail_name || current.from_snail, events: nextEvents.sort((left, right) => (left.seq || 0) - (right.seq || 0)) };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimeStatus(event) {
    const current = ensureRealtimeRecord({ ...event, role: event.final_role || "assistant" });
    const next = { ...current, role: event.final_role || current.role, from_snail: event.snail_name || current.from_snail, status: event.status || current.status, localError: event.status === "failed" ? (event.error_text || current.localError || "Unknown error") : null };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function markOptimisticError(clientId, errorText) {
    const key = `optimistic:${clientId}`;
    const current = state.byKey.get(key);
    if (!current) return;
    rebuildIndexes(state.records.map((record) => record.key === key ? { ...current, localError: errorText, status: "failed" } : record));
  }

  function getMessageById(messageId) { return state.byPersistedId.get(messageId) || null; }

  return { reset, getState, replaceHistory, addOptimisticMessage, applyRealtimeStart, applyRealtimeEvent, applyRealtimeStatus, markOptimisticError, getMessageById };
}
