import test from "node:test";
import assert from "node:assert/strict";
import {
  addGlucoseReading,
  addInsulinReading,
  basalEndHour,
  clampDayIndex,
  glucoseRange,
  glucoseWarning,
  HYPERGLYCEMIA_MESSAGE,
  HYPOGLYCEMIA_MESSAGE,
  parseDelimitedSpreadsheet,
  parseDelimitedInsulinSpreadsheet,
  normalizeInsulinReading,
  removeReadingById,
  toDateKey,
} from "../metrics.js";

test("records a glucose value with its date and time", () => {
  const timestamp = new Date(2026, 8, 14, 9, 35);
  const days = addGlucoseReading([], { id: "new-reading", value: 123, timestamp });
  assert.equal(days.length, 1);
  assert.equal(days[0].key, "2026-09-14");
  assert.deepEqual(days[0].glucose[0], {
    id: "new-reading",
    type: "glucose",
    hour: 9 + 35 / 60,
    value: 123,
  });
});

test("keeps only the latest seven days after recording", () => {
  const sourceDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2026, 8, index + 1, 12);
    return { date, key: toDateKey(date), glucose: [], insulin: [] };
  });
  const updated = addGlucoseReading(sourceDays, { value: 110, timestamp: new Date(2026, 8, 8, 8) });
  assert.equal(updated.length, 7);
  assert.equal(updated[0].key, "2026-09-02");
  assert.equal(updated.at(-1).glucose[0].value, 110);
});

test("records a Basal insulin delivery with quantity, timestamp, and duration", () => {
  const timestamp = new Date(2026, 8, 14, 21, 30);
  const days = addInsulinReading([], { id: "basal-entry", insulinType: "Basal", value: 12.3, durationMinutes: 180, timestamp });
  assert.deepEqual(days[0].insulin[0], {
    id: "basal-entry",
    type: "insulin",
    insulinType: "basal",
    hour: 21.5,
    value: 12.3,
    durationMinutes: 180,
  });
});

test("requires one insulin type and enforces quantity and Basal duration limits", () => {
  const timestamp = new Date(2026, 8, 14, 9);
  assert.throws(() => normalizeInsulinReading({ insulinType: "", value: 1, timestamp }), /exactly one insulin type/i);
  assert.throws(() => normalizeInsulinReading({ insulinType: "bolus", value: 0, timestamp }), /0\.1 through 200\.0/);
  assert.throws(() => normalizeInsulinReading({ insulinType: "bolus", value: 1.25, timestamp }), /0\.1-unit increments/);
  assert.throws(() => normalizeInsulinReading({ insulinType: "basal", value: 1, durationMinutes: 0, timestamp }), /1 through 720/);
  assert.throws(() => normalizeInsulinReading({ insulinType: "basal", value: 1, durationMinutes: 721, timestamp }), /1 through 720/);
  assert.equal(normalizeInsulinReading({ insulinType: "bolus", value: 200, timestamp }).durationMinutes, null);
});

test("ends the Basal duration line at the earlier of delivery end or 23:00", () => {
  assert.equal(basalEndHour({ insulinType: "basal", hour: 8, durationMinutes: 120 }), 10);
  assert.equal(basalEndHour({ insulinType: "basal", hour: 22, durationMinutes: 180 }), 23);
});

test("limits navigation to the available seven-day window", () => {
  assert.equal(clampDayIndex(-1, 7), 0);
  assert.equal(clampDayIndex(3, 7), 3);
  assert.equal(clampDayIndex(7, 7), 6);
});

test("uses the requirement-defined range boundaries", () => {
  assert.equal(glucoseRange(40), "low");
  assert.equal(glucoseRange(70), "low");
  assert.equal(glucoseRange(79), "low");
  assert.equal(glucoseRange(80), "acceptable");
  assert.equal(glucoseRange(115), "acceptable");
  assert.equal(glucoseRange(116), "borderline-high");
  assert.equal(glucoseRange(179), "borderline-high");
  assert.equal(glucoseRange(180), "high");
  assert.equal(glucoseRange(400), "high");
  assert.equal(glucoseRange(75), "low");
  assert.equal(glucoseRange(130), "borderline-high");
});

test("creates exact warnings for the low range and values above the high threshold", () => {
  assert.equal(glucoseWarning(39), null);
  assert.equal(glucoseWarning(40).message, HYPOGLYCEMIA_MESSAGE);
  assert.equal(glucoseWarning(69).message, HYPOGLYCEMIA_MESSAGE);
  assert.equal(glucoseWarning(70).message, HYPOGLYCEMIA_MESSAGE);
  assert.equal(glucoseWarning(79).message, HYPOGLYCEMIA_MESSAGE);
  assert.equal(glucoseWarning(181).message, HYPERGLYCEMIA_MESSAGE);
  assert.equal(glucoseWarning(80), null);
  assert.equal(glucoseWarning(180), null);
});

test("parses Excel-compatible CSV rows in chronological order", () => {
  const readings = parseDelimitedSpreadsheet("timestamp,glucose\n2026-09-01 12:00,190\n2026-09-01 08:00,65");
  assert.deepEqual(readings.map((reading) => reading.value), [65, 190]);
});

test("parses separate date and time spreadsheet columns", () => {
  const readings = parseDelimitedSpreadsheet("date,time,glucose\n2026-09-01,09:30,105");
  assert.equal(readings[0].value, 105);
  assert.equal(readings[0].timestamp.getHours(), 9);
  assert.equal(readings[0].timestamp.getMinutes(), 30);
});

test("parses spreadsheet insulin deliveries and requires duration for Basal rows", () => {
  const readings = parseDelimitedInsulinSpreadsheet("timestamp,type,quantity,duration\n2026-09-01 09:30,Basal,10.5,120\n2026-09-01 12:00,Bolus,2.4,");
  assert.deepEqual(readings.map(({ insulinType, value, durationMinutes }) => ({ insulinType, value, durationMinutes })), [
    { insulinType: "basal", value: 10.5, durationMinutes: 120 },
    { insulinType: "bolus", value: 2.4, durationMinutes: null },
  ]);
  assert.throws(() => parseDelimitedInsulinSpreadsheet("date,time,type,quantity\n2026-09-01,09:30,Basal,10"), /Basal duration/i);
});

test("rejects spreadsheets without required columns", () => {
  assert.throws(() => parseDelimitedSpreadsheet("date,dose\n2026-09-01,4"), /timestamp.*glucose/i);
});

test("removes only the confirmed reading from its collection", () => {
  const readings = [{ id: "a", value: 100 }, { id: "b", value: 120 }];
  assert.equal(removeReadingById(readings, "a"), true);
  assert.deepEqual(readings, [{ id: "b", value: 120 }]);
  assert.equal(removeReadingById(readings, "missing"), false);
});

test("formats local dates without UTC rollover", () => {
  assert.equal(toDateKey(new Date(2026, 7, 28, 23, 30)), "2026-08-28");
});
