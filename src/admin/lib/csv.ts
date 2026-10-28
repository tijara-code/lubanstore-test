/**
 * A CSV made in the browser from what the tab holds (Payments, Customers), and handed to the
 * person as a file. Excel opens UTF-8 with the BOM; cells with a comma, a quote or a line break
 * are quoted; a cell starting with = + - @ is prefixed with ' so a spreadsheet never runs it.
 */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvOf(rows: ReadonlyArray<ReadonlyArray<Cell>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(name: string, rows: ReadonlyArray<ReadonlyArray<Cell>>): void {
  const blob = new Blob(["﻿" + csvOf(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
