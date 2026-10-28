"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const SWITCH = [
  { role: "OPS", label: "OPS", name: "Manish", email: "ops@shipdelight.com", go: "/ops" },
  { role: "ACCOUNTS", label: "Accounts", name: "Ankit R.", email: "accounts@shipdelight.com", go: "/accounts" },
  { role: "MANAGEMENT", label: "Management", name: "Vikram N.", email: "mgmt@shipdelight.com", go: "/management" },
];

/** Floating demo-sandbox controls, shown on every screen while AUTH_MODE=dev. */
export function DemoBar({ role }: { role: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg(text);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  };

  return (
    <div className="demo">
      {open && (
        <div className="demo-box">
          <div>
            <h4>Demo sandbox</h4>
            <p>Dummy orders, private to you. Logging out deletes everything you did.</p>
          </div>
          <div>
            <p style={{ marginBottom: 6 }}>Switch role (keeps your test data)</p>
            <div className="demo-row">
              {SWITCH.map((s) => (
                <button key={s.role} type="button" className={s.role === role ? "on" : ""} disabled={busy !== null || s.role === role}
                  onClick={() => run(`switch-${s.role}`, async () => { await send("/api/dev-login", "POST", { name: s.name, email: s.email, role: s.role }); router.push(s.go); })}>
                  {busy === `switch-${s.role}` ? "…" : s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="demo-row">
            <button type="button" disabled={busy !== null}
              onClick={() => run("escalate", async () => { const d = await send("/api/demo/escalate", "POST"); return `15-day escalation checked ${d.checked} case(s) and escalated ${d.escalated}.`; })}>
              {busy === "escalate" ? "Running…" : "Run 15-day escalation"}
            </button>
            <button type="button" disabled={busy !== null}
              onClick={() => {
                if (!confirm("Discard all your test changes and restore the original dummy orders?")) return;
                run("reset", async () => { await send("/api/demo/reset", "POST"); return "Demo orders restored to their original state."; });
              }}>
              {busy === "reset" ? "Resetting…" : "Reset demo data"}
            </button>
          </div>
          <div className="demo-row">
            <Link href="/demo" style={{ alignSelf: "center", color: "var(--teal)", textDecoration: "underline", fontSize: 12 }}>Test guide</Link>
            <button type="button" className="danger" style={{ marginLeft: "auto" }} disabled={busy !== null}
              onClick={() => run("logout", async () => { await send("/api/dev-login", "DELETE"); router.push("/"); })}>
              {busy === "logout" ? "Flushing…" : "Log out & flush"}
            </button>
          </div>
          {msg && <p style={{ color: "var(--teal-dark)" }}>{msg}</p>}
        </div>
      )}
      <button type="button" className="demo-pill" onClick={() => setOpen(!open)}>
        <span className="live" /> Demo sandbox {open ? "▾" : "▴"}
      </button>
    </div>
  );
}
