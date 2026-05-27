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

function cloneContext(context) {
  return context ? { ...context } : null;
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
  if (optimistic.clientId && persisted.clientId) return optimistic.clientId === persisted.clientId;
  if (optimistic.role !== persisted.role) return false;
  if ((optimistic.from_role || null) !== (persisted.from_role || null)) return false;
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
  if (record.status === "pending_approval") return "pending_approval";
  if (record.status === "cancelled" || record.status === "interrupted") return record.status;
  if ((record.events || []).some((event) => event.category === "content")) return "streaming";
  if (record.role === "assistant" && (record.events || []).some((event) => event.kind === "start")) return "thinking";
  return record.optimistic ? "pending" : "idle";
}

function isTerminalStatus(status) {
  return ["completed", "failed", "cancelled", "interrupted"].includes(status);
}

function mergeEvents(leftEvents, rightEvents) {
  const byId = new Map();
  [...cloneEvents(leftEvents), ...cloneEvents(rightEvents)].forEach((event) => {
    const key = Number.isInteger(event?.id) ? `id:${event.id}` : `seq:${event?.seq ?? byId.size}:${event?.kind ?? "unknown"}`;
    byId.set(key, event);
  });
  return Array.from(byId.values()).sort((left, right) => (left.seq || 0) - (right.seq || 0));
}

function mergeContentEventsForClientAck(events, record) {
  if (record.role !== "user" || !record.clientId) return events;
  const result = [];
  events.forEach((event) => {
    const existingIndex = result.findIndex((item) => !Number.isInteger(item.id) && Number.isInteger(event?.id) && sameUserContentEvent(item, event));
    if (existingIndex >= 0) result.splice(existingIndex, 1, event);
    else result.push(event);
  });
  return result;
}

function sameUserContentEvent(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "text") return (left.payload?.text || "") === (right.payload?.text || "");
  if (left.kind === "content_block") {
    return JSON.stringify(left.payload?.blocks || []) === JSON.stringify(right.payload?.blocks || [])
      && (left.payload?.fallback_text || null) === (right.payload?.fallback_text || null);
  }
  return false;
}

function mergePersistedWithExisting(persisted, existing) {
  if (!existing) return persisted;
  const existingStatus = existing.status || "completed";
  const persistedStatus = persisted.status || "completed";
  const status = isTerminalStatus(existingStatus) && !isTerminalStatus(persistedStatus) ? existingStatus : persistedStatus;
  return {
    ...persisted,
    clientId: existing.clientId || persisted.clientId || null,
    status,
    events: mergeContentEventsForClientAck(mergeEvents(persisted.events || [], existing.events || []), { ...persisted, clientId: existing.clientId || persisted.clientId || null }),
    context: cloneContext(persisted.context || existing.context || null),
    optimistic: false,
    localError: existing.localError || persisted.localError || null,
  };
}

function failedSignalReason(record) {
  const signal = (record.events || []).slice().reverse().find((event) => event.kind === "signal" && event.payload?.type === "message_failed" && event.payload?.reason);
  return signal?.payload?.reason || null;
}

function createRecordFromPersisted(message) {
  return {
    key: `message:${message.id}`,
    id: message.id,
    conversation_id: message.conversation_id || null,
    clientId: message.client_id || null,
    role: message.role,
    from_role: message.from_role || null,
    quoted_message_id: message.quoted_message_id || null,
    quoted_message: message.quoted_message || null,
    created_at: message.created_at,
    status: message.status || "completed",
    events: cloneEvents(message.events || []),
    context: cloneContext(message.context || null),
    optimistic: false,
    localError: null,
  };
}

function createRecordFromRealtime(event) {
  const roleName = event.role_name || null;
  return {
    key: `message:${event.message_id}`,
    id: event.message_id,
    conversation_id: event.conversation_id || null,
    clientId: event.client_id || null,
    role: event.role || event.event?.payload?.role || (roleName === "system" ? "system" : roleName === "Boss Role" ? "user" : "assistant"),
    from_role: roleName,
    quoted_message_id: null,
    quoted_message: null,
    created_at: event.event?.created_at || new Date().toISOString(),
    status: event.status || "streaming",
    events: [],
    context: null,
    optimistic: false,
    localError: null,
  };
}

function createRecordFromOptimistic(input) {
  return {
    key: `optimistic:${input.clientId}`,
    id: null,
    conversation_id: input.conversation_id || null,
    clientId: input.clientId,
    role: input.role,
    from_role: input.from_role || null,
    quoted_message_id: input.quoted_message_id || null,
    quoted_message: input.quoted_message || null,
    created_at: input.created_at,
    status: "streaming",
    events: cloneEvents(input.events || []),
    context: null,
    optimistic: true,
    localError: null,
  };
}

function createStoreState() {
  return { activeConversationId: null, records: [], byKey: new Map(), byPersistedId: new Map() };
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
    state = { ...state, records: records.slice().sort(compareMessageOrder), byKey, byPersistedId };
    onChange?.(getState());
  }

  function getState() {
    return { activeConversationId: state.activeConversationId, records: state.records.slice(), byPersistedId: new Map(state.byPersistedId) };
  }

  function reset(conversationId = null) {
    state = { ...state, activeConversationId: conversationId || null };
    rebuildIndexes([]);
  }

  function isActiveConversationPayload(input) {
    if (!state.activeConversationId) return true;
    const conversationId = input?.conversation_id || input?.event?.conversation_id || null;
    return !conversationId || conversationId === state.activeConversationId;
  }

  function replaceHistory(conversationIdOrMessages, maybeMessages) {
    const conversationId = Array.isArray(conversationIdOrMessages) ? state.activeConversationId : conversationIdOrMessages;
    const messages = Array.isArray(conversationIdOrMessages) ? conversationIdOrMessages : maybeMessages;
    if (state.activeConversationId && conversationId && conversationId !== state.activeConversationId) return;
    const rawPersistedRecords = (Array.isArray(messages) ? messages : [])
      .filter(isActiveConversationPayload)
      .map(createRecordFromPersisted);
    const matchedOptimisticKeys = new Set();
    const persistedRecords = rawPersistedRecords.map((persisted) => {
      const existing = state.byPersistedId.get(persisted.id);
      const optimistic = state.records.find((record) => record.optimistic && !matchedOptimisticKeys.has(record.key) && matchOptimisticToPersisted(record, persisted));
      if (optimistic) matchedOptimisticKeys.add(optimistic.key);
      return [existing, optimistic].filter(Boolean).reduce((record, current) => mergePersistedWithExisting(record, current), persisted);
    });
    const persistedIds = new Set(persistedRecords.map((record) => record.id).filter(Number.isInteger));
    const concurrentRealtimeRecords = state.records.filter((record) => !record.optimistic && Number.isInteger(record.id) && !persistedIds.has(record.id));
    const unmatchedOptimistic = state.records.filter((record) => record.optimistic && !matchedOptimisticKeys.has(record.key));
    rebuildIndexes([...persistedRecords, ...concurrentRealtimeRecords, ...unmatchedOptimistic]);
  }

  function addOptimisticMessage(input) {
    if (!isActiveConversationPayload(input)) return null;
    const record = createRecordFromOptimistic(input);
    rebuildIndexes([...state.records, record]);
    return record;
  }

  function findOptimisticByClientId(clientId) {
    return clientId ? state.byKey.get(`optimistic:${clientId}`) || null : null;
  }

  function ensureRealtimeStartRecord(event) {
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

  function findRealtimeRecord(messageId) {
    return state.byPersistedId.get(messageId) || null;
  }

  function applyRealtimeStart(event) {
    if (!isActiveConversationPayload(event)) return;
    const current = ensureRealtimeStartRecord(event);
    const next = { ...current, role: event.role || current.role, from_role: event.role_name || current.from_role, status: event.status || current.status };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimeEvent(event) {
    if (!isActiveConversationPayload(event)) return;
    const current = findRealtimeRecord(event.message_id) || (event.event && Number.isInteger(event.message_id) ? ensureRealtimeStartRecord(event) : null);
    if (!current) return;
    const nextEvents = cloneEvents(current.events).filter((item) => {
      if (!event.event) return true;
      if (item.id === event.event.id) return false;
      /**
       * Boss messages are rendered optimistically before the server persists them.
       * The matching realtime event later carries a durable id, so id-only de-dupe
       * would keep both copies visible until a full history reload replaces local state.
       */
      if (current.role === "user" && current.clientId && !Number.isInteger(item.id) && sameUserContentEvent(item, event.event)) return false;
      return true;
    });
    if (event.event) nextEvents.push({ ...event.event, payload: event.event.payload ? { ...event.event.payload } : event.event.payload });
    const next = { ...current, from_role: event.role_name || current.from_role, events: nextEvents.sort((left, right) => (left.seq || 0) - (right.seq || 0)) };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimeContext(messageId, context) {
    const current = findRealtimeRecord(messageId);
    if (!current || !context) return;
    const next = { ...current, context: cloneContext(context) };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function applyRealtimeStatus(event) {
    if (!isActiveConversationPayload(event)) return;
    const current = findRealtimeRecord(event.message_id);
    if (!current) return;
    const next = { ...current, role: event.final_role || current.role, from_role: event.role_name || current.from_role, status: event.status || current.status, context: cloneContext(event.context || current.context || null), localError: event.status === "failed" ? (event.error_text || failedSignalReason(current) || current.localError || "Unknown error") : null };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  function markOptimisticError(clientId, errorText) {
    const key = `optimistic:${clientId}`;
    const current = state.byKey.get(key);
    if (!current) return;
    rebuildIndexes(state.records.map((record) => record.key === key ? { ...current, localError: errorText, status: "failed" } : record));
  }

  function getMessageById(messageId) { return state.byPersistedId.get(messageId) || null; }

  function applyPermissionRequired(event) {
    if (!isActiveConversationPayload(event)) return;
    const current = findRealtimeRecord(event.message_id);
    if (!current) return;
    const next = {
      ...current,
      status: "pending_approval",
      permissionRequest: {
        toolName: event.request?.tool_name ?? "unknown",
        toolInput: event.request?.tool_input ?? {},
        toolUseId: event.request?.tool_use_id ?? "",
      },
    };
    rebuildIndexes(state.records.map((record) => record.key === current.key ? next : record));
  }

  return { reset, getState, replaceHistory, addOptimisticMessage, applyRealtimeStart, applyRealtimeEvent, applyRealtimeContext, applyRealtimeStatus, applyPermissionRequired, markOptimisticError, getMessageById };
}
