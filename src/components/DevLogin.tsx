"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PRESETS = [
  { role: "OPS", name: "Manish", email: "ops@shipdelight.com", go: "/ops", title: "OPS", desc: "Mark cases, chase couriers, record courier CNs and status updates." },
  { role: "ACCOUNTS", name: "Ankit R.", email: "accounts@shipdelight.com", go: "/accounts", title: "Accounts", desc: "Release brand CNs, request exceptions, record courier settlements." },
  { role: "MANAGEMENT", name: "Vikram N.", email: "mgmt@shipdelight.com", go: "/management", title: "Management", desc: "Dashboard, approvals and escalations." },
];

export function DevLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(p: (typeof PRESETS)[number]) {
    setBusy(p.role);
    setError(null);
    const res = await fetch("/api/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: p.name, email: p.email, role: p.role }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Could not start the demo (${res.status})`);
      setBusy(null);
      return;
    }
    router.push(p.go);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {PRESETS.map((p) => (
        <button key={p.role} type="button" className="radio-card" disabled={busy !== null} onClick={() => pick(p)} style={{ opacity: busy && busy !== p.role ? 0.5 : 1 }}>
          <span className="r" />
          <span>
            <div className="t">Continue as {p.title} · {p.name}</div>
            <div className="d">{p.desc}</div>
          </span>
        </button>
      ))}
      {busy && <p className="note-sm" style={{ margin: "4px 0 0" }}>Setting up your private demo sandbox with dummy orders. This takes a few seconds…</p>}
      {error && <p className="errline">{error}</p>}
    </div>
  );
}
