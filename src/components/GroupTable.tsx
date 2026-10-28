import Link from "next/link";
import { href } from "./ui";
import { inr } from "@/lib/format";
import type { GroupRow } from "@/lib/queries";

type Variant = "ops" | "ready" | "await" | "approval" | "released";

/** "View by Courier / Client" summary table. "View AWBs" switches to the AWB list filtered to that row. */
export function GroupTable({
  rows, by, variant, path, current,
}: {
  rows: GroupRow[];
  by: "courier" | "client";
  variant: Variant;
  path: string;
  current: Record<string, string | undefined>;
}) {
  if (rows.length === 0) return <div className="empty">No cases match these filters.</div>;
  const sum = (f: (r: GroupRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const avg = Math.round(sum((r) => r.avgAge * r.cases) / Math.max(sum((r) => r.cases), 1));
  const link = (r: GroupRow) => href(path, current, { view: "awb", [by]: r.key, page: undefined });
  const first = by === "courier" ? "Courier" : "Client";
  const name = (r: GroupRow) => (
    <>
      {r.key}
      {by === "client" && variant !== "ops" && r.duesAmount > 0 && r.duesAge >= 30 && <span className="t-orange"> · dues {inr(r.duesAmount)}</span>}
    </>
  );

  if (variant === "ops") {
    return (
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{first}</th><th className="num">Open cases</th><th className="num">Lost</th><th className="num">Damage</th><th className="num">Claim value</th><th className="num">CN received (30 d)</th><th className="num">CN rejected</th><th className="num">Avg ageing</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="mid strong">{r.key}</td><td className="num mid">{r.cases}</td><td className="num mid">{r.lost}</td><td className="num mid">{r.damage}</td>
                <td className="num mid">{inr(r.claimValue)}</td><td className="num mid t-green">{inr(r.cnRecent)}</td><td className="num mid">{r.rejected}</td><td className="num mid">{r.avgAge} d</td>
                <td className="mid num"><Link className="btn btn-sm" href={link(r)}>View AWBs</Link></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total</td><td className="num">{sum((r) => r.cases)}</td><td className="num">{sum((r) => r.lost)}</td><td className="num">{sum((r) => r.damage)}</td><td className="num">{inr(sum((r) => r.claimValue))}</td><td className="num">{inr(sum((r) => r.cnRecent))}</td><td className="num">{sum((r) => r.rejected)}</td><td className="num">{avg} d</td><td /></tr></tfoot>
        </table>
      </div>
    );
  }

  const waiting = variant === "ready" ? "Oldest waiting" : "Oldest case";
  const cnHead = variant === "await" || variant === "approval" ? "Claim value" : "Courier CN received";
  const cn = (r: GroupRow) => (variant === "await" || variant === "approval" ? r.claimValue : r.courierCn);
  const gap = (r: GroupRow) => (variant === "await" || variant === "approval" ? Math.max(0, r.brandLiability - r.claimValue) : r.sdGap);
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>{first}</th><th className="num">Cases</th><th className="num">Brand liability</th><th className="num">{cnHead}</th><th className="num">SD gap</th><th className="num">{waiting}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="mid strong" style={{ fontWeight: 500 }}>{name(r)}</td>
              <td className="num mid">{r.cases}</td>
              <td className="num mid strong">{inr(r.brandLiability)}</td>
              <td className="num mid t-green">{inr(cn(r))}</td>
              <td className="num mid t-orange">{inr(gap(r))}</td>
              <td className="num mid">{r.oldest} d</td>
              <td className="mid num"><Link className="btn btn-sm" href={link(r)}>View AWBs</Link></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total</td><td className="num">{sum((r) => r.cases)}</td><td className="num">{inr(sum((r) => r.brandLiability))}</td><td className="num t-green">{inr(sum(cn))}</td><td className="num t-orange">{inr(sum(gap))}</td><td className="num">{Math.max(...rows.map((r) => r.oldest))} d</td><td /></tr></tfoot>
      </table>
    </div>
  );
}
