export const LOW_RANGE = Object.freeze({ min: 40, max: 80 });
export const ACCEPTABLE_RANGE = Object.freeze({ min: 80, max: 115 });
export const BORDERLINE_HIGH_RANGE = Object.freeze({ min: 115, max: 180 });
export const HIGH_RANGE = Object.freeze({ min: 180, max: 400 });

export const HYPOGLYCEMIA_MESSAGE =
  "Hypoglycemia. Eat or drink fast acting sugar right away. Then allow 15 minutes before checking blood sugar levels.";
export const HYPERGLYCEMIA_MESSAGE = "Alert Hyperglycemia! Take appropriate action.";

export function clampDayIndex(index, dayCount) {
  return Math.max(0, Math.min(index, dayCount - 1));
}

export function removeReadingById(readings, readingId) {
  const index = readings.findIndex((reading) => reading.id === readingId);
  if (index === -1) return false;
  readings.splice(index, 1);
  return true;
}

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function glucoseRange(value) {
  if (value >= LOW_RANGE.min && value < LOW_RANGE.max) return "low";
  if (value >= ACCEPTABLE_RANGE.min && value <= ACCEPTABLE_RANGE.max) return "acceptable";
  if (value > BORDERLINE_HIGH_RANGE.min && value < BORDERLINE_HIGH_RANGE.max) return "borderline-high";
  if (value >= HIGH_RANGE.min && value <= HIGH_RANGE.max) return "high";
  return "outside-defined-ranges";
}

export function glucoseWarning(value) {
  if (glucoseRange(value) === "low") {
    return { kind: "hypoglycemia", title: "Low glucose warning", message: HYPOGLYCEMIA_MESSAGE };
  }
  if (value > HIGH_RANGE.min) {
    return { kind: "hyperglycemia", title: "High glucose warning", message: HYPERGLYCEMIA_MESSAGE };
  }
  return null;
}

function parseDelimitedRow(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function spreadsheetRowsToReadings(rows) {
  if (rows.length < 2) throw new Error("The spreadsheet must include a header and at least one data row.");
  const headers = rows[0].map((header) => String(header ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const timestampIndex = headers.findIndex((header) => ["timestamp", "datetime", "dateandtime"].includes(header));
  const dateIndex = headers.indexOf("date");
  const timeIndex = headers.indexOf("time");
  const glucoseIndex = headers.findIndex((header) => ["glucose", "glucosemgdl", "bloodglucose", "value"].includes(header));
  if (glucoseIndex === -1 || (timestampIndex === -1 && dateIndex === -1)) {
    throw new Error("Use timestamp + glucose, or date + time + glucose columns.");
  }

  const readings = [];
  rows.slice(1).forEach((row, rowIndex) => {
    if (row.every((cell) => String(cell ?? "").trim() === "")) return;
    const rawDate = timestampIndex >= 0 ? row[timestampIndex] : `${row[dateIndex] ?? ""} ${timeIndex >= 0 ? row[timeIndex] ?? "" : ""}`.trim();
    const timestamp = rawDate instanceof Date ? rawDate : new Date(rawDate);
    const value = Number(row[glucoseIndex]);
    if (Number.isNaN(timestamp.getTime()) || !Number.isFinite(value)) {
      throw new Error(`Row ${rowIndex + 2} has an invalid date/time or glucose value.`);
    }
    readings.push({ timestamp, value });
  });
  if (!readings.length) throw new Error("No glucose readings were found in the spreadsheet.");
  return readings.sort((a, b) => a.timestamp - b.timestamp);
}

export function parseDelimitedSpreadsheet(text, delimiter) {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const selectedDelimiter = delimiter ?? (normalized.split("\n", 1)[0].includes("\t") ? "\t" : ",");
  const rows = normalized.split(/\r?\n/).map((line) => parseDelimitedRow(line, selectedDelimiter));
  return spreadsheetRowsToReadings(rows);
}
