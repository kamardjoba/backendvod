export const state = {
  users: [],
  rest_periods: [],
  audit_logs: [],
  notifications: [],
  seq: {
    users: 1,
    rest_periods: 1,
    audit_logs: 1,
    notifications: 1,
  },
};

export function nowIso() {
  return new Date().toISOString();
}

export function nextId(table) {
  const id = state.seq[table];
  state.seq[table] += 1;
  return id;
}

export function clone(row) {
  return structuredClone(row);
}
