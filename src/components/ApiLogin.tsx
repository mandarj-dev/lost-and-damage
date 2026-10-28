"use client";
// Dev sign-in: pick a role and paste that role's backend token (kept in this browser's localStorage only).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_ROLES, DEFAULT_BASE, getBase, getToken, setBase, setRole, setToken, type ApiRole } from "@/lib/api";
import { ROLE_HOME } from "./ApiKit";

const DESC: Record<ApiRole, string> = {
  OPS: "Mark cases, chase couriers, record courier CNs and status updates.",
  ACCOUNTS: "Release client CNs, request exceptions, record courier settlements.",
  MANAGEMENT: "Dashboard report, approvals and escalations.",
  KAM: "Client liability and client statements.",
};

export function ApiLogin() {
  const router = useRouter();
  const [base, setB] = useState(DEFAULT_BASE);
  const [tokens, setT] = useState<Record<string, string>>({});
  useEffect(() => {
    setB(getBase());
    setT(Object.fromEntries(API_ROLES.map((r) => [r, getToken(r)])));
  }, []);
  const save = () => { setBase(base || DEFAULT_BASE); API_ROLES.forEach((r) => setToken(r, tokens[r] ?? "")); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label className="field"><div className="lbl">Backend base URL</div>
        <input className="input" value={base} onChange={(e) => setB(e.target.value)} placeholder="https://smart-financeapi-dev.shipdelight.com" /></label>
      {API_ROLES.map((r) => (
        <div key={r} className="radio-card" style={{ display: "block" }}>
          <div className="t">{r}</div>
          <div className="d">{DESC[r]}</div>
          <input className="input" type="password" autoComplete="off" placeholder={`Paste ${r} bearer token`} value={tokens[r] ?? ""}
            onChange={(e) => setT({ ...tokens, [r]: e.target.value })} style={{ width: "100%", margin: "8px 0" }} />
          <button type="button" className="btn btn-sm btn-primary" disabled={!tokens[r]}
            onClick={() => { save(); setRole(r); router.push(ROLE_HOME[r]); }}>Continue as {r}</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={save}>Save tokens</button>
      <p className="note-sm">Tokens stay in this browser (localStorage) and are sent as Authorization: Bearer to {base}/dispute-operations.</p>
    </div>
  );
}
