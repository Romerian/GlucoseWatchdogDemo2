import {
  parseDelimitedInsulinSpreadsheet,
  parseDelimitedSpreadsheet,
  spreadsheetRowsToInsulinReadings,
  spreadsheetRowsToReadings,
} from "./metrics.js?v=gwt7-1";

const decoder = new TextDecoder("utf-8");

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress Excel workbooks. Save the sheet as CSV and try again.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("The selected .xlsx file is not a valid Excel workbook.");

  const entries = new Map();
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The Excel workbook directory is invalid.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (data) entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXml(bytes, label) {
  const document = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`The Excel ${label} XML is invalid.`);
  return document;
}

function excelDate(serial) {
  return new Date((Number(serial) - 25569) * 86400000);
}

function columnIndex(reference) {
  const letters = reference.match(/[A-Z]+/i)?.[0] ?? "A";
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function parseXlsx(buffer, rowsToReadings) {
  const entries = await unzip(buffer);
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml") ?? [...entries.entries()].find(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))?.[1];
  if (!sheetBytes) throw new Error("The Excel workbook does not contain a worksheet.");

  const sharedBytes = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedBytes
    ? [...parseXml(sharedBytes, "shared strings").querySelectorAll("si")].map((item) => [...item.querySelectorAll("t")].map((node) => node.textContent).join(""))
    : [];
  const sheet = parseXml(sheetBytes, "worksheet");
  const rows = [...sheet.querySelectorAll("sheetData > row")].map((row) => {
    const values = [];
    row.querySelectorAll("c").forEach((cell) => {
      const index = columnIndex(cell.getAttribute("r") ?? "A1");
      const type = cell.getAttribute("t");
      const raw = cell.querySelector("v")?.textContent ?? cell.querySelector("is t")?.textContent ?? "";
      values[index] = type === "s" ? sharedStrings[Number(raw)] ?? "" : raw;
    });
    return values;
  });

  const headers = (rows[0] ?? []).map((value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  const timestampIndex = headers.findIndex((header) => ["timestamp", "datetime", "dateandtime", "deliverytimestamp"].includes(header));
  const dateIndex = headers.indexOf("date");
  const timeIndex = headers.indexOf("time");
  rows.slice(1).forEach((row) => {
    const dateColumn = timestampIndex >= 0 ? timestampIndex : dateIndex;
    if (dateColumn >= 0 && row[dateColumn] !== "" && Number.isFinite(Number(row[dateColumn]))) {
      const serial = Number(row[dateColumn]) + (timeIndex >= 0 && Number.isFinite(Number(row[timeIndex])) ? Number(row[timeIndex]) : 0);
      row[dateColumn] = excelDate(serial);
      if (timestampIndex === -1 && timeIndex >= 0) row[timeIndex] = "";
    }
  });
  return rowsToReadings(rows);
}

export async function parseSpreadsheetFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return parseXlsx(await file.arrayBuffer(), spreadsheetRowsToReadings);
  if (["csv", "tsv", "txt"].includes(extension)) {
    return parseDelimitedSpreadsheet(await file.text(), extension === "tsv" ? "\t" : undefined);
  }
  throw new Error("Choose an .xlsx, .csv, or .tsv spreadsheet.");
}

export async function parseInsulinSpreadsheetFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return parseXlsx(await file.arrayBuffer(), spreadsheetRowsToInsulinReadings);
  if (["csv", "tsv", "txt"].includes(extension)) {
    return parseDelimitedInsulinSpreadsheet(await file.text(), extension === "tsv" ? "\t" : undefined);
  }
  throw new Error("Choose an .xlsx, .csv, or .tsv spreadsheet.");
}
