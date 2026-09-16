import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  earliestAuditWindowStart,
  latestAuditWindowStart,
  recordsForAuditWindow,
  shiftAuditWindow,
} from "../audit.js";

test("defines the latest audit view as a seven-day interval", () => {
  const now = new Date(2026, 8, 16, 15, 30);
  assert.equal(latestAuditWindowStart(now).toString(), new Date(2026, 8, 10).toString());
});

test("limits audit navigation to the previous 12 months", () => {
  const now = new Date(2026, 8, 16, 15, 30);
  const earliest = earliestAuditWindowStart(now);
  assert.equal(earliest.toString(), new Date(2025, 8, 16).toString());
  assert.equal(shiftAuditWindow(earliest, -1, now).toString(), earliest.toString());
  assert.equal(
    shiftAuditWindow(latestAuditWindowStart(now), 1, now).toString(),
    latestAuditWindowStart(now).toString(),
  );
});

test("returns only records in the selected seven-day interval in newest-first order", () => {
  const records = [
    { id: "before", timestamp: new Date(2026, 8, 9, 23, 59) },
    { id: "first", timestamp: new Date(2026, 8, 10, 8, 0) },
    { id: "latest", timestamp: new Date(2026, 8, 16, 18, 0) },
    { id: "after", timestamp: new Date(2026, 8, 17, 0, 0) },
  ];
  assert.deepEqual(
    recordsForAuditWindow(records, new Date(2026, 8, 10)).map((record) => record.id),
    ["latest", "first"],
  );
});

test("provides a separate read-only audit view with every required field and return control", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const viewStart = markup.indexOf('<section id="audit-view"');
  const viewEnd = markup.indexOf("</section>", viewStart);
  const auditView = markup.slice(viewStart, viewEnd);

  assert.match(markup, /id="open-audit-trail"[^>]*>Audit Trail</);
  assert.match(auditView, /id="return-to-main"[^>]*>Return to main page</);
  assert.match(auditView, />Date</);
  assert.match(auditView, />Time</);
  assert.match(auditView, />Activity type</);
  assert.match(auditView, />Description</);
  assert.match(auditView, /Previous 7 days/);
  assert.match(auditView, /Next 7 days/);
  assert.doesNotMatch(auditView, /<input|<textarea|contenteditable/);
});
