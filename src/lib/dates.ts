// Date text exactly as the Figma shows it: "06 Oct 2026", "06 Oct", "Sep" (never "Sept"), UTC so server and browser agree.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const p2 = (n: number) => String(n).padStart(2, "0");
type D = Date | string;

export const fmtDay = (d: D) => {
  const x = new Date(d);
  return `${p2(x.getUTCDate())} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};
export const fmtDayShort = (d: D) => {
  const x = new Date(d);
  return `${p2(x.getUTCDate())} ${MON[x.getUTCMonth()]}`;
};
export const fmtDayTime = (d: D) => {
  const x = new Date(d);
  return `${fmtDay(x)}, ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`;
};
/** "Oct" from "2026-10". */
export const monthShort = (ym: string) => MON[Number(ym.slice(5, 7)) - 1] ?? "";
/** "Sep 2026" from "2026-09". */
export const monthShortYear = (ym: string) => `${monthShort(ym)} ${ym.slice(0, 4)}`;
/** "October 2026" from "2026-10". */
export const monthFull = (ym: string) => `${MONTH[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;
