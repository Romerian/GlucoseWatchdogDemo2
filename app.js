import {
  ACCEPTABLE_RANGE,
  BORDERLINE_HIGH_RANGE,
  clampDayIndex,
  glucoseWarning,
  HIGH_RANGE,
  LOW_RANGE,
  removeReadingById,
  toDateKey,
} from "./metrics.js";
import { parseSpreadsheetFile } from "./spreadsheet.js";

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
      { id: `${key}-i-0`, type: "insulin", hour: 7.75, value: dayIndex % 2 ? 5 : 4 },
      { id: `${key}-i-1`, type: "insulin", hour: 12.25, value: dayIndex % 3 ? 6 : 5 },
      { id: `${key}-i-2`, type: "insulin", hour: 18.75, value: dayIndex % 2 ? 7 : 6 },
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

const dimensions = { left: 68, right: 964, top: 24, bottom: 348 };
const yMin = LOW_RANGE.min;
const yMax = HIGH_RANGE.max;
const xForHour = (hour) => dimensions.left + (hour / 24) * (dimensions.right - dimensions.left);
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
  return `Insulin ${reading.value} units, ${shortDateFormatter.format(date)} at ${timeFormatter.format(date)}`;
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
  tooltip.innerHTML = `<strong>${reading.type === "glucose" ? `${reading.value} mg/dL` : `${reading.value} units insulin`}</strong><span>${shortDateFormatter.format(date)} · ${timeFormatter.format(date)}</span>`;
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

[readingDialog, confirmDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

render();
