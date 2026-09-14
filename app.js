import {
  ACCEPTABLE_RANGE,
  addGlucoseReading,
  addInsulinReading,
  basalEndHour,
  BORDERLINE_HIGH_RANGE,
  clampDayIndex,
  glucoseWarning,
  HIGH_RANGE,
  LOW_RANGE,
  removeReadingById,
  toDateKey,
} from "./metrics.js?v=gwt7-1";
import { parseInsulinSpreadsheetFile, parseSpreadsheetFile } from "./spreadsheet.js?v=gwt7-2";

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY_COUNT = 7;
const WARNING_REPEAT_MS = 5 * 60 * 1000;
const HOURS = [0.5, 2.5, 4.5, 6.5, 8.5, 10.5, 12.5, 14.5, 16.5, 18.5, 20.5, 22.5];
const GLUCOSE_PATTERNS = [
  [104, 96, 91, 82, 125, 151, 128, 142, 119, 134, 112, 101],
  [117, 107, 95, 72, 111, 166, 144, 122, 109, 156, 131, 108],
  [121, 113, 102, 88, 139, 184, 162, 141, 123, 149, 128, 116],
  [109, 101, 92, 67, 108, 146, 121, 111, 103, 128, 114, 99],
  [126, 116, 107, 94, 143, 172, 151, 132, 118, 141, 124, 110],
  [112, 103, 96, 79, 132, 159, 137, 126, 114, 152, 130, 106],
  [118, 108, 99, 86, 136, 168, 145, 127, 114, 153, 129, 111],
];

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function createDemoDays() {
  return Array.from({ length: DAY_COUNT }, (_, dayIndex) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (DAY_COUNT - 1 - dayIndex));
    const key = toDateKey(date);
    const glucose = HOURS.map((hour, index) => ({ id: `${key}-g-${index}`, type: "glucose", hour, value: GLUCOSE_PATTERNS[dayIndex][index] }));
    const insulin = [
      { id: `${key}-i-0`, type: "insulin", insulinType: "bolus", hour: 7.75, value: dayIndex % 2 ? 5 : 4, durationMinutes: null },
      { id: `${key}-i-1`, type: "insulin", insulinType: "bolus", hour: 12.25, value: dayIndex % 3 ? 6 : 5, durationMinutes: null },
      { id: `${key}-i-2`, type: "insulin", insulinType: "bolus", hour: 18.75, value: dayIndex % 2 ? 7 : 6, durationMinutes: null },
    ];
    return { date, key, glucose, insulin };
  });
}

function createImportedDays(readings) {
  const groups = new Map();
  readings.forEach((reading, index) => {
    const key = toDateKey(reading.timestamp);
    if (!groups.has(key)) {
      const date = new Date(reading.timestamp);
      date.setHours(12, 0, 0, 0);
      groups.set(key, { date, key, glucose: [], insulin: [] });
    }
    groups.get(key).glucose.push({
      id: `${key}-import-${index}`,
      type: "glucose",
      hour: reading.timestamp.getHours() + reading.timestamp.getMinutes() / 60,
      value: reading.value,
    });
  });
  return [...groups.values()].sort((a, b) => a.date - b.date).slice(-DAY_COUNT);
}

let days = createDemoDays();
const state = { dayIndex: days.length - 1, selected: null, activeWarning: null, warningTimer: null };
const svg = document.querySelector("#glucose-chart");
const tooltip = document.querySelector("#chart-tooltip");
const readingDialog = document.querySelector("#reading-dialog");
const confirmDialog = document.querySelector("#confirm-dialog");
const warningDialog = document.querySelector("#warning-dialog");
const toast = document.querySelector("#toast");
const entryDialog = document.querySelector("#glucose-entry-dialog");
const insulinEntryDialog = document.querySelector("#insulin-entry-dialog");
const importDialog = document.querySelector("#import-dialog");
const entryForm = document.querySelector("#glucose-entry-form");
const insulinEntryForm = document.querySelector("#insulin-entry-form");
const glucoseLevelInput = document.querySelector("#glucose-level");
const readingDateInput = document.querySelector("#reading-date");
const readingTimeInput = document.querySelector("#reading-time");
const entryStatus = document.querySelector("#entry-status");
const insulinQuantityInput = document.querySelector("#insulin-quantity");
const basalDurationField = document.querySelector("#basal-duration-field");
const basalDurationInput = document.querySelector("#basal-duration");
const insulinDateInput = document.querySelector("#insulin-date");
const insulinTimeInput = document.querySelector("#insulin-time");
const insulinEntryStatus = document.querySelector("#insulin-entry-status");

const dimensions = { left: 68, right: 930, top: 24, bottom: 348 };
const yMin = LOW_RANGE.min;
const yMax = HIGH_RANGE.max;
const xForHour = (hour) => dimensions.left + (hour / 24) * (dimensions.right - dimensions.left);
const yForInsulin = (value) => dimensions.bottom - (value / 200) * (dimensions.bottom - dimensions.top);
const yForValue = (value) => {
  const bounded = Math.max(yMin, Math.min(yMax, value));
  return dimensions.bottom - ((bounded - yMin) / (yMax - yMin)) * (dimensions.bottom - dimensions.top);
};

function svgElement(tag, attributes = {}, text = "") {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
}

function readingDate(day, reading) {
  const date = new Date(day.date);
  const hours = Math.floor(reading.hour);
  date.setHours(hours, Math.round((reading.hour - hours) * 60), 0, 0);
  return date;
}

function renderChart(day) {
  svg.querySelectorAll(":scope > :not(title):not(desc)").forEach((node) => node.remove());
  tooltip.hidden = true;
  const plotWidth = dimensions.right - dimensions.left;
  svg.append(svgElement("rect", { x: dimensions.left, y: dimensions.top, width: plotWidth, height: dimensions.bottom - dimensions.top, class: "range-undefined" }));
  [
    { from: HIGH_RANGE.min, to: HIGH_RANGE.max, className: "range-high" },
    { from: BORDERLINE_HIGH_RANGE.min, to: BORDERLINE_HIGH_RANGE.max, className: "range-borderline-high" },
    { from: ACCEPTABLE_RANGE.min, to: ACCEPTABLE_RANGE.max, className: "range-normal" },
    { from: LOW_RANGE.min, to: LOW_RANGE.max, className: "range-low" },
  ].forEach((band) => {
    const top = yForValue(band.to);
    const bottom = yForValue(band.from);
    svg.append(svgElement("rect", { x: dimensions.left, y: top, width: plotWidth, height: bottom - top, class: band.className }));
  });

  [40, 80, 115, 180, 250, 325, 400].forEach((value) => {
    const y = yForValue(value);
    svg.append(svgElement("line", { x1: dimensions.left, y1: y, x2: dimensions.right, y2: y, class: "grid-line" }));
    svg.append(svgElement("text", { x: dimensions.left - 16, y: y + 5, class: "axis-label", "text-anchor": "end" }, String(value)));
  });

  for (let hour = 0; hour <= 24; hour += 4) {
    const x = xForHour(hour);
    svg.append(svgElement("line", { x1: x, y1: dimensions.top, x2: x, y2: dimensions.bottom, class: "vertical-grid" }));
    const label = hour === 0 || hour === 24 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
    svg.append(svgElement("text", { x, y: dimensions.bottom + 34, class: "axis-label", "text-anchor": hour === 0 ? "start" : hour === 24 ? "end" : "middle" }, label));
  }
  svg.append(svgElement("text", { x: 13, y: 18, class: "axis-unit" }, "mg/dL"));
  [0, 50, 100, 150, 200].forEach((value) => {
    svg.append(svgElement("text", { x: dimensions.right + 13, y: yForInsulin(value) + 5, class: "axis-label", "text-anchor": "start" }, String(value)));
  });
  svg.append(svgElement("text", { x: dimensions.right + 13, y: 18, class: "axis-unit" }, "units"));

  if (day.glucose.length) {
    const path = day.glucose.slice().sort((a, b) => a.hour - b.hour)
      .map((reading, index) => `${index ? "L" : "M"} ${xForHour(reading.hour)} ${yForValue(reading.value)}`).join(" ");
    svg.append(svgElement("path", { d: path, class: "glucose-path" }));
  }

  day.glucose.forEach((reading) => {
    const node = svgElement("circle", {
      cx: xForHour(reading.hour), cy: yForValue(reading.value), r: 7, class: "glucose-point",
      tabindex: "0", role: "button", "aria-label": glucoseLabel(day, reading), "data-reading-id": reading.id,
    });
    bindReadingEvents(node, day, reading);
    svg.append(node);
  });

  day.insulin.forEach((reading) => {
    if (reading.insulinType === "basal") {
      const line = svgElement("line", {
        x1: xForHour(reading.hour),
        y1: yForInsulin(reading.value),
        x2: xForHour(basalEndHour(reading)),
        y2: yForInsulin(reading.value),
        class: "basal-duration-line",
        tabindex: "0",
        role: "button",
        "aria-label": insulinLabel(day, reading),
        "data-reading-id": reading.id,
      });
      bindReadingEvents(line, day, reading);
      svg.append(line);
      return;
    }

    const x = xForHour(reading.hour);
    const group = svgElement("g", { class: "insulin-point", tabindex: "0", role: "button", "aria-label": insulinLabel(day, reading), "data-reading-id": reading.id });
    group.append(svgElement("line", { x1: x, y1: dimensions.bottom - 48, x2: x, y2: dimensions.bottom, class: "insulin-stem" }));
    group.append(svgElement("path", { d: `M ${x} ${dimensions.bottom - 57} l 8 11 -8 11 -8 -11 Z`, class: "insulin-diamond" }));
    group.append(svgElement("text", { x, y: dimensions.bottom - 63, class: "insulin-label", "text-anchor": "middle" }, `${reading.value}u`));
    bindReadingEvents(group, day, reading);
    svg.append(group);
  });
}

function glucoseLabel(day, reading) {
  const date = readingDate(day, reading);
  return `Glucose ${reading.value} milligrams per deciliter, ${shortDateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function insulinLabel(day, reading) {
  const date = readingDate(day, reading);
  const type = reading.insulinType === "basal" ? "Basal" : "Bolus";
  const duration = reading.insulinType === "basal" ? ` for ${reading.durationMinutes} minutes,` : ",";
  return `${type} insulin ${reading.value} units${duration} ${shortDateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function bindReadingEvents(node, day, reading) {
  node.addEventListener("mouseenter", (event) => showTooltip(event, day, reading));
  node.addEventListener("mousemove", positionTooltip);
  node.addEventListener("mouseleave", hideTooltip);
  node.addEventListener("focus", (event) => showTooltip(event, day, reading));
  node.addEventListener("blur", hideTooltip);
  node.addEventListener("click", () => openReading(day, reading));
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openReading(day, reading);
    }
  });
}

function showTooltip(event, day, reading) {
  const date = readingDate(day, reading);
  const insulinType = reading.insulinType === "basal" ? "Basal" : "Bolus";
  const duration = reading.insulinType === "basal" ? ` · ${reading.durationMinutes} min` : "";
  tooltip.innerHTML = `<strong>${reading.type === "glucose" ? `${reading.value} mg/dL` : `${reading.value} units ${insulinType}`}</strong><span>${shortDateFormatter.format(date)} · ${timeFormatter.format(date)}${duration}</span>`;
  tooltip.hidden = false;
  positionTooltip(event);
}

function positionTooltip(event) {
  const wrap = document.querySelector(".chart-wrap").getBoundingClientRect();
  const source = event.currentTarget.getBoundingClientRect();
  tooltip.style.left = `${source.left - wrap.left + source.width / 2}px`;
  tooltip.style.top = `${Math.max(8, source.top - wrap.top - 12)}px`;
}

function hideTooltip() { tooltip.hidden = true; }

function openReading(day, reading) {
  const date = readingDate(day, reading);
  state.selected = { day, reading };
  const isGlucose = reading.type === "glucose";
  document.querySelector("#reading-kind").textContent = isGlucose ? "Glucose reading" : "Insulin reading";
  document.querySelector("#detail-date").textContent = dateFormatter.format(date);
  document.querySelector("#detail-time").textContent = timeFormatter.format(date);
  document.querySelector("#detail-value-label").textContent = isGlucose ? "Value" : "Dosage";
  document.querySelector("#detail-value").textContent = isGlucose ? `${reading.value} mg/dL` : `${reading.value} units`;
  const typeRow = document.querySelector("#detail-insulin-type-row");
  const durationRow = document.querySelector("#detail-duration-row");
  typeRow.hidden = isGlucose;
  durationRow.hidden = isGlucose || reading.insulinType !== "basal";
  document.querySelector("#detail-insulin-type").textContent = reading.insulinType === "basal" ? "Basal" : "Bolus";
  document.querySelector("#detail-duration").textContent = reading.insulinType === "basal" ? `${reading.durationMinutes} minutes` : "";
  readingDialog.showModal();
}

function latestGlucoseValue() {
  const latestDay = days.at(-1);
  return latestDay?.glucose.slice().sort((a, b) => b.hour - a.hour)[0]?.value;
}

function showWarning(warning) {
  state.activeWarning = warning;
  document.querySelector("#warning-title").textContent = warning.title;
  document.querySelector("#warning-message").textContent = warning.message;
  if (!warningDialog.open) warningDialog.showModal();
}

function evaluateLatestWarning() {
  const value = latestGlucoseValue();
  if (value === undefined) return;
  const warning = glucoseWarning(value);
  if (warning) showWarning(warning);
  else if (value >= ACCEPTABLE_RANGE.min && value <= ACCEPTABLE_RANGE.max) {
    state.activeWarning = null;
    window.clearTimeout(state.warningTimer);
    if (warningDialog.open) warningDialog.close();
  }
}

function scheduleWarningRepeat() {
  window.clearTimeout(state.warningTimer);
  state.warningTimer = window.setTimeout(() => {
    const value = latestGlucoseValue();
    if (value >= ACCEPTABLE_RANGE.min && value <= ACCEPTABLE_RANGE.max) {
      state.activeWarning = null;
      return;
    }
    showWarning(glucoseWarning(value) ?? state.activeWarning);
  }, WARNING_REPEAT_MS);
}

function setEntryTimestamp(date) {
  readingDateInput.value = toDateKey(date);
  readingTimeInput.value = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function setInsulinEntryTimestamp(date) {
  insulinDateInput.value = toDateKey(date);
  insulinTimeInput.value = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function selectedInsulinType() {
  return insulinEntryForm.elements.namedItem("insulin-type").value;
}

function updateBasalDurationField() {
  const isBasal = selectedInsulinType() === "basal";
  basalDurationField.hidden = !isBasal;
  basalDurationInput.disabled = !isBasal;
  basalDurationInput.required = isBasal;
  if (!isBasal) basalDurationInput.value = "";
}

function recordInsulinEntry(event) {
  event.preventDefault();
  insulinEntryStatus.textContent = "";
  if (!insulinEntryForm.reportValidity()) return;

  const timestamp = new Date(`${insulinDateInput.value}T${insulinTimeInput.value}`);
  const insulinType = selectedInsulinType();
  try {
    days = addInsulinReading(days, {
      insulinType,
      value: insulinQuantityInput.value,
      durationMinutes: basalDurationInput.value,
      timestamp,
    });
  } catch (error) {
    insulinEntryStatus.textContent = error.message;
    return;
  }

  const recordedDayIndex = days.findIndex((day) => day.key === toDateKey(timestamp));
  state.dayIndex = recordedDayIndex >= 0 ? recordedDayIndex : days.length - 1;
  state.selected = null;
  render();
  insulinEntryStatus.textContent = `Recorded ${insulinType} insulin: ${Number(insulinQuantityInput.value).toFixed(1)} units on ${shortDateFormatter.format(timestamp)} at ${timeFormatter.format(timestamp)}.`;
  insulinQuantityInput.value = "";
  basalDurationInput.value = "";
}

function importInsulinReadings(readings) {
  return readings.reduce((updatedDays, reading, index) => addInsulinReading(updatedDays, {
    ...reading,
    id: `${toDateKey(reading.timestamp)}-insulin-import-${reading.timestamp.getTime()}-${index}`,
  }), days);
}

function recordGlucoseEntry(event) {
  event.preventDefault();
  entryStatus.textContent = "";
  if (!entryForm.reportValidity()) return;

  const value = Number(glucoseLevelInput.value);
  const timestamp = new Date(`${readingDateInput.value}T${readingTimeInput.value}`);
  if (!Number.isFinite(value) || Number.isNaN(timestamp.getTime())) return;

  days = addGlucoseReading(days, { value, timestamp });
  const recordedDayIndex = days.findIndex((day) => day.key === toDateKey(timestamp));
  state.dayIndex = recordedDayIndex >= 0 ? recordedDayIndex : days.length - 1;
  state.selected = null;
  render();
  evaluateLatestWarning();
  entryStatus.textContent = `Recorded ${value} mg/dL on ${shortDateFormatter.format(timestamp)} at ${timeFormatter.format(timestamp)}.`;
  glucoseLevelInput.value = "";
}

function render() {
  const day = days[state.dayIndex];
  document.querySelector("#chart-date").textContent = dateFormatter.format(day.date);
  document.querySelector("#previous-day").disabled = state.dayIndex === 0;
  document.querySelector("#next-day").disabled = state.dayIndex === days.length - 1;
  document.querySelector("#today-button").disabled = state.dayIndex === days.length - 1;
  renderChart(day);
}

document.querySelector("#previous-day").addEventListener("click", () => { state.dayIndex = clampDayIndex(state.dayIndex - 1, days.length); render(); });
document.querySelector("#next-day").addEventListener("click", () => { state.dayIndex = clampDayIndex(state.dayIndex + 1, days.length); render(); });
document.querySelector("#today-button").addEventListener("click", () => { state.dayIndex = days.length - 1; render(); });
document.querySelector("#close-reading").addEventListener("click", () => readingDialog.close());
document.querySelector("#cancel-reading").addEventListener("click", () => readingDialog.close());
document.querySelector("#request-delete").addEventListener("click", () => { readingDialog.close(); confirmDialog.showModal(); });
document.querySelector("#cancel-delete").addEventListener("click", () => confirmDialog.close());
document.querySelector("#confirm-delete").addEventListener("click", () => {
  if (!state.selected) return;
  const { day, reading } = state.selected;
  removeReadingById(reading.type === "glucose" ? day.glucose : day.insulin, reading.id);
  state.selected = null;
  confirmDialog.close();
  render();
  evaluateLatestWarning();
  toast.hidden = false;
  window.clearTimeout(toast.hideTimer);
  toast.hideTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
});
document.querySelector("#acknowledge-warning").addEventListener("click", () => {
  warningDialog.close();
  scheduleWarningRepeat();
});
document.querySelector("#open-glucose-entry").addEventListener("click", () => {
  entryStatus.textContent = "";
  entryDialog.showModal();
});
document.querySelector("#close-glucose-entry").addEventListener("click", () => entryDialog.close());
document.querySelector("#open-insulin-entry").addEventListener("click", () => {
  insulinEntryStatus.textContent = "";
  document.querySelector("#insulin-import-status").textContent = "";
  insulinEntryDialog.showModal();
});
document.querySelector("#close-insulin-entry").addEventListener("click", () => insulinEntryDialog.close());
document.querySelector("#open-import-dialog").addEventListener("click", () => {
  document.querySelector("#import-status").textContent = "";
  importDialog.showModal();
});
document.querySelector("#close-import-dialog").addEventListener("click", () => importDialog.close());
document.querySelector("#use-current-time").addEventListener("click", () => setEntryTimestamp(new Date()));
document.querySelector("#use-current-insulin-time").addEventListener("click", () => setInsulinEntryTimestamp(new Date()));
insulinEntryForm.querySelectorAll('input[name="insulin-type"]').forEach((input) => input.addEventListener("change", updateBasalDurationField));
entryForm.addEventListener("submit", recordGlucoseEntry);
insulinEntryForm.addEventListener("submit", recordInsulinEntry);
document.querySelector("#spreadsheet-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = document.querySelector("#import-status");
  try {
    status.textContent = "Importing spreadsheet…";
    const readings = await parseSpreadsheetFile(file);
    days = createImportedDays(readings);
    state.dayIndex = days.length - 1;
    state.selected = null;
    render();
    status.textContent = `Loaded ${readings.length} glucose reading${readings.length === 1 ? "" : "s"} across ${days.length} day${days.length === 1 ? "" : "s"}.`;
    evaluateLatestWarning();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#insulin-spreadsheet-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = document.querySelector("#insulin-import-status");
  try {
    status.textContent = "Importing insulin spreadsheet…";
    const readings = await parseInsulinSpreadsheetFile(file);
    days = importInsulinReadings(readings);
    const latestImportedDate = readings.at(-1).timestamp;
    const importedDayIndex = days.findIndex((day) => day.key === toDateKey(latestImportedDate));
    state.dayIndex = importedDayIndex >= 0 ? importedDayIndex : days.length - 1;
    state.selected = null;
    render();
    status.textContent = `Loaded ${readings.length} insulin deliver${readings.length === 1 ? "y" : "ies"}.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    event.target.value = "";
  }
});

[entryDialog, insulinEntryDialog, importDialog, readingDialog, confirmDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

render();
