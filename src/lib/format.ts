import { fmtDay, fmtDayShort, fmtDayTime, monthFull } from "./dates";

export const inr = (n?: number | null) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** "06 Oct 2026" */
export const day = (d?: Date | string | null) => (d ? fmtDay(d) : "—");

/** "06 Oct" */
export const dayShort = (d?: Date | string | null) => (d ? fmtDayShort(d) : "—");

/** "06 Oct 2026, 11:20" */
export const dayTime = (d?: Date | string | null) => (d ? fmtDayTime(d) : "—");

export const label = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const ageDays = (d?: Date | string | null) =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : 0;

/** Value for <input type="date"> */
export const isoDay = (d: Date | string = new Date()) => new Date(d).toISOString().slice(0, 10);

export const monthName = (ym?: string | null) => (ym ? monthFull(ym) : "");

export const fileSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};