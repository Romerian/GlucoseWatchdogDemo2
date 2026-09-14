export const LOW_RANGE = Object.freeze({ min: 40, max: 80 });
export const ACCEPTABLE_RANGE = Object.freeze({ min: 80, max: 115 });
export const BORDERLINE_HIGH_RANGE = Object.freeze({ min: 115, max: 180 });
export const HIGH_RANGE = Object.freeze({ min: 180, max: 400 });
export const INSULIN_QUANTITY_RANGE = Object.freeze({ min: 0.1, max: 200 });
export const BASAL_DURATION_RANGE = Object.freeze({ min: 1, max: 720 });

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

export function addGlucoseReading(days, reading, dayCount = 7) {
  const key = toDateKey(reading.timestamp);
  const updatedDays = days.map((day) => ({ ...day, glucose: [...day.glucose], insulin: [...day.insulin] }));
  let targetDay = updatedDays.find((day) => day.key === key);

  if (!targetDay) {
    const date = new Date(reading.timestamp);
    date.setHours(12, 0, 0, 0);
    targetDay = { date, key, glucose: [], insulin: [] };
    updatedDays.push(targetDay);
  }

  targetDay.glucose.push({
    id: reading.id ?? `${key}-entry-${reading.timestamp.getTime()}`,
    type: "glucose",
    hour: reading.timestamp.getHours() + reading.timestamp.getMinutes() / 60,
    value: reading.value,
  });
  targetDay.glucose.sort((a, b) => a.hour - b.hour);

  return updatedDays.sort((a, b) => a.date - b.date).slice(-dayCount);
}

export function normalizeInsulinReading(reading) {
  const insulinType = String(reading.insulinType ?? "").trim().toLowerCase();
  if (!['basal', 'bolus'].includes(insulinType)) {
    throw new Error("Select exactly one insulin type: Basal or Bolus.");
  }

  const value = Number(reading.value);
  const isTenthUnit = Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
  if (!Number.isFinite(value) || value < INSULIN_QUANTITY_RANGE.min || value > INSULIN_QUANTITY_RANGE.max || !isTenthUnit) {
    throw new Error("Insulin quantity must be 0.1 through 200.0 units in 0.1-unit increments.");
  }

  const timestamp = reading.timestamp instanceof Date ? new Date(reading.timestamp) : new Date(reading.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Enter a valid insulin delivery date and time.");

  let durationMinutes = null;
  if (insulinType === "basal") {
    durationMinutes = Number(reading.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < BASAL_DURATION_RANGE.min || durationMinutes > BASAL_DURATION_RANGE.max) {
      throw new Error("Basal duration must be 1 through 720 minutes.");
    }
  }

  return { insulinType, value, timestamp, durationMinutes };
}

export function addInsulinReading(days, reading, dayCount = 7) {
  const normalized = normalizeInsulinReading(reading);
  const key = toDateKey(normalized.timestamp);
  const updatedDays = days.map((day) => ({ ...day, glucose: [...day.glucose], insulin: [...day.insulin] }));
  let targetDay = updatedDays.find((day) => day.key === key);

  if (!targetDay) {
    const date = new Date(normalized.timestamp);
    date.setHours(12, 0, 0, 0);
    targetDay = { date, key, glucose: [], insulin: [] };
    updatedDays.push(targetDay);
  }

  targetDay.insulin.push({
    id: reading.id ?? `${key}-insulin-entry-${normalized.timestamp.getTime()}`,
    type: "insulin",
    insulinType: normalized.insulinType,
    hour: normalized.timestamp.getHours() + normalized.timestamp.getMinutes() / 60,
    value: normalized.value,
    durationMinutes: normalized.durationMinutes,
  });
  targetDay.insulin.sort((a, b) => a.hour - b.hour);

  return updatedDays.sort((a, b) => a.date - b.date).slice(-dayCount);
}

export function basalEndHour(reading) {
  if (reading.insulinType !== "basal") return reading.hour;
  return Math.min(23, reading.hour + reading.durationMinutes / 60);
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

export function spreadsheetRowsToInsulinReadings(rows) {
  if (rows.length < 2) throw new Error("The spreadsheet must include a header and at least one data row.");
  const headers = rows[0].map((header) => String(header ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const timestampIndex = headers.findIndex((header) => ["timestamp", "datetime", "dateandtime", "deliverytimestamp"].includes(header));
  const dateIndex = headers.indexOf("date");
  const timeIndex = headers.indexOf("time");
  const typeIndex = headers.findIndex((header) => ["type", "insulintype"].includes(header));
  const quantityIndex = headers.findIndex((header) => ["quantity", "insulinquantity", "dose", "dosage", "units"].includes(header));
  const durationIndex = headers.findIndex((header) => ["duration", "durationminutes", "basalduration", "basaldurationminutes"].includes(header));
  if (typeIndex === -1 || quantityIndex === -1 || (timestampIndex === -1 && dateIndex === -1)) {
    throw new Error("Use timestamp + type + quantity, or date + time + type + quantity columns.");
  }

  const readings = [];
  rows.slice(1).forEach((row, rowIndex) => {
    if (row.every((cell) => String(cell ?? "").trim() === "")) return;
    const rawDate = timestampIndex >= 0 ? row[timestampIndex] : `${row[dateIndex] ?? ""} ${timeIndex >= 0 ? row[timeIndex] ?? "" : ""}`.trim();
    try {
      readings.push(normalizeInsulinReading({
        timestamp: rawDate instanceof Date ? rawDate : new Date(rawDate),
        insulinType: row[typeIndex],
        value: row[quantityIndex],
        durationMinutes: durationIndex >= 0 ? row[durationIndex] : null,
      }));
    } catch (error) {
      throw new Error(`Row ${rowIndex + 2}: ${error.message}`);
    }
  });
  if (!readings.length) throw new Error("No insulin deliveries were found in the spreadsheet.");
  return readings.sort((a, b) => a.timestamp - b.timestamp);
}

export function parseDelimitedSpreadsheet(text, delimiter) {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const selectedDelimiter = delimiter ?? (normalized.split("\n", 1)[0].includes("\t") ? "\t" : ",");
  const rows = normalized.split(/\r?\n/).map((line) => parseDelimitedRow(line, selectedDelimiter));
  return spreadsheetRowsToReadings(rows);
}

export function parseDelimitedInsulinSpreadsheet(text, delimiter) {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const selectedDelimiter = delimiter ?? (normalized.split("\n", 1)[0].includes("\t") ? "\t" : ",");
  const rows = normalized.split(/\r?\n/).map((line) => parseDelimitedRow(line, selectedDelimiter));
  return spreadsheetRowsToInsulinReadings(rows);
}
