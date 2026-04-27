function compareMessageOrder(left, right) {
  const leftTime = Date.parse(left.created_at || "") || 0;
  const rightTime = Date.parse(right.created_at || "") || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftId = Number.isInteger(left.id) ? left.id : Number.MAX_SAFE_INTEGER;
  const rightId = Number.isInteger(right.id) ? right.id : Number.MAX_SAFE_INTEGER;
  if (leftId !== rightId) return leftId - rightId;
  return String(left.key).localeCompare(String(right.key));
}

function cloneParts(parts) {
  return Array.isArray(parts) ? parts.map((part) => ({ ...part, payload: part?.payload ? { ...part.payload } : part.payload })) : [];
}

function resultPayloadText(payload) {
  if (!payload) return "";
  switch (payload.format) {
    case "blocks":
      return payload.fallback_text || "";
    default:
      return "";
  }
}

function matchOptimisticToPersisted(optimistic, persisted) {
  if (!optimistic || !persisted) return false;
  if (optimistic.role !== persisted.role) return false;
  if ((optimistic.from_snail || null) !== (persisted.from_snail || null)) return false;
  if ((optimistic.quoted_message_id || null) !== (persisted.quoted_message_id || null)) return false;
  const optimisticResult = optimistic.parts.find((part) => part.kind === "result");
  const persistedResult = persisted.parts.find((part) => part.kind === "result");
  if (!optimisticResult || !persistedResult) return false;
  const optimisticText = resultPayloadText(optimisticResult.payload).trim();
  const persistedText = resultPayloadText(persistedResult.payload).trim();
  if (!optimisticText || optimisticText !== persistedText) return false;
  const optimisticTime = Date.parse(optimistic.created_at || "") || 0;
  const persistedTime = Date.parse(persisted.created_at || "") || 0;
  return Math.abs(optimisticTime - persistedTime) < 60 * 1000;
}

function deriveStatus(record) {
  const endPart = record.parts.find((part) => part.kind === "end");
  if (endPart?.payload?.status === "error") return "error";
  if (record.localError) return "error";
  if (record.parts.some((part) => part.kind === "result")) return "done";
  if (record.parts.some((part) => part.kind === "delta")) return "streaming";
  if (record.startEvent || record.parts.some((part) => part.kind === "start")) return "thinking";
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
    parts: cloneParts(message.parts || []),
    startEvent: null,
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
    parts: [],
    startEvent: null,
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
    parts: cloneParts(input.parts || []),
    startEvent: null,
    optimistic: true,
    localError: null,
  };
}

function createStoreState() {
  return {
    records: [],
    byKey: new Map(),
    byPersistedId: new Map(),
  };
}

export function createMessageStore(onChange) {
  let state = createStoreState();

  function rebuildIndexes(records) {
    const byKey = new Map();
    const byPersistedId = new Map();
    records.forEach((record) => {
      record.status = deriveStatus(record);
      byKey.set(record.key, record);
      if (Number.isInteger(record.id)) {
        byPersistedId.set(record.id, record);
      }
    });
    state = {
      records: records.slice().sort(compareMessageOrder),
      byKey,
      byPersistedId,
    };
    onChange?.(getState());
  }

  function getState() {
    return {
      records: state.records.slice(),
      byPersistedId: new Map(state.byPersistedId),
    };
  }

  function reset() {
    rebuildIndexes([]);
  }

  function replaceHistory(messages) {
    const persistedRecords = (Array.isArray(messages) ? messages : []).map(createRecordFromPersisted);
    const matchedOptimisticKeys = new Set();
    persistedRecords.forEach((persisted) => {
      const match = state.records.find((record) => {
        if (!record.optimistic || matchedOptimisticKeys.has(record.key)) return false;
        return matchOptimisticToPersisted(record, persisted);
      });
      if (match) {
        matchedOptimisticKeys.add(match.key);
      }
    });
    const unmatchedOptimistic = state.records.filter((record) => {
      if (!record.optimistic) return false;
      return !matchedOptimisticKeys.has(record.key);
    });
    rebuildIndexes([...persistedRecords, ...unmatchedOptimistic]);
  }

  function addOptimisticMessage(input) {
    const record = createRecordFromOptimistic(input);
    rebuildIndexes([...state.records, record]);
    return record;
  }

  function findOptimisticByClientId(clientId) {
    if (!clientId) return null;
    return state.byKey.get(`optimistic:${clientId}`) || null;
  }

  function ensureRealtimeRecord(event) {
    const existing = state.byPersistedId.get(event.message_id);
    if (existing) return existing;
    const optimistic = findOptimisticByClientId(event.client_id);
    if (optimistic) {
      const upgraded = {
        ...optimistic,
        key: `message:${event.message_id}`,
        id: event.message_id,
        clientId: event.client_id || optimistic.clientId || null,
        optimistic: false,
        localError: null,
      };
      rebuildIndexes(state.records.map((record) => record.key === optimistic.key ? upgraded : record));
      return state.byPersistedId.get(event.message_id);
    }
    const record = createRecordFromRealtime(event);
    rebuildIndexes([...state.records, record]);
    return state.byPersistedId.get(event.message_id);
  }

  function applyRealtimeStart(event) {
    const current = ensureRealtimeRecord(event);
    const next = {
      ...current,
      role: event.role || current.role,
      from_snail: event.snail_name || current.from_snail,
      startEvent: { ...event },
    };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimePart(event) {
    const current = ensureRealtimeRecord({ ...event, role: "assistant" });
    const nextParts = current.parts.filter((part) => !(part.kind === "result" && event.part?.kind === "result"));
    if (event.part) {
      nextParts.push({ ...event.part, payload: event.part.payload ? { ...event.part.payload } : event.part.payload });
    }
    const next = {
      ...current,
      from_snail: event.snail_name || current.from_snail,
      parts: nextParts,
    };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimeEnd(event) {
    const current = ensureRealtimeRecord({ ...event, role: event.final_role || "assistant" });
    const nextParts = current.parts.filter((part) => part.kind !== "end");
    nextParts.push({
      id: -1,
      message_id: event.message_id,
      kind: "end",
      payload: {
        status: event.status,
        ...(event.error_text ? { error_text: event.error_text } : {}),
      },
      created_at: new Date().toISOString(),
    });
    const next = {
      ...current,
      role: event.final_role || current.role,
      from_snail: event.snail_name || current.from_snail,
      parts: nextParts,
      localError: event.status === "error" ? (event.error_text || current.localError || "Unknown error") : null,
    };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function markOptimisticError(clientId, errorText) {
    const key = `optimistic:${clientId}`;
    const current = state.byKey.get(key);
    if (!current) return;
    const next = {
      ...current,
      localError: errorText,
    };
    rebuildIndexes(state.records.map((record) => record.key === key ? next : record));
  }

  function getMessageById(messageId) {
    return state.byPersistedId.get(messageId) || null;
  }

  return {
    reset,
    getState,
    replaceHistory,
    addOptimisticMessage,
    applyRealtimeStart,
    applyRealtimePart,
    applyRealtimeEnd,
    markOptimisticError,
    getMessageById,
  };
}
