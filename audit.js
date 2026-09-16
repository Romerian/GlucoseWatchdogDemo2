export const AUDIT_WINDOW_DAYS = 7;
export const AUDIT_HISTORY_MONTHS = 12;

export function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function latestAuditWindowStart(now = new Date()) {
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - (AUDIT_WINDOW_DAYS - 1));
  return start;
}

export function earliestAuditWindowStart(now = new Date()) {
  const earliest = startOfLocalDay(now);
  earliest.setMonth(earliest.getMonth() - AUDIT_HISTORY_MONTHS);
  return earliest;
}

export function clampAuditWindowStart(value, now = new Date()) {
  const requested = startOfLocalDay(value);
  const earliest = earliestAuditWindowStart(now);
  const latest = latestAuditWindowStart(now);
  if (requested < earliest) return earliest;
  if (requested > latest) return latest;
  return requested;
}

export function shiftAuditWindow(value, direction, now = new Date()) {
  const shifted = startOfLocalDay(value);
  shifted.setDate(shifted.getDate() + direction * AUDIT_WINDOW_DAYS);
  return clampAuditWindowStart(shifted, now);
}

export function auditWindowEnd(value) {
  const end = startOfLocalDay(value);
  end.setDate(end.getDate() + AUDIT_WINDOW_DAYS);
  return end;
}

export function recordsForAuditWindow(records, windowStart) {
  const start = startOfLocalDay(windowStart);
  const end = auditWindowEnd(start);
  return records
    .filter((record) => {
      const timestamp = new Date(record.timestamp);
      return timestamp >= start && timestamp < end;
    })
    .slice()
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}
