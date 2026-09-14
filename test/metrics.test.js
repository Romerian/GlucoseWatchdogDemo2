import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addGlucoseReading,
  clampDayIndex,
  glucoseRange,
  glucoseWarning,
  HYPERGLYCEMIA_MESSAGE,
  HYPOGLYCEMIA_MESSAGE,
  parseDelimitedSpreadsheet,
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

test("keeps glucose spreadsheet import inside the Add Glucose Reading dialog", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const dialogStart = markup.indexOf('<dialog id="glucose-entry-dialog"');
  const dialogEnd = markup.indexOf("</dialog>", dialogStart);
  const glucoseDialog = markup.slice(dialogStart, dialogEnd);

  assert.match(glucoseDialog, /id="spreadsheet-file"/);
  assert.match(glucoseDialog, />Import spreadsheet</);
  assert.doesNotMatch(markup, /id="open-import-dialog"|id="import-dialog"/);
});
