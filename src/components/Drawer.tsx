"use client";
import { useEffect, type ReactNode } from "react";

/** Right-hand side panel used for every action form (Update status, Release CN, Record settlement…). */
export function Drawer({
  title, subtitle, onClose, children, footer, pinned,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** Always-visible block above the footer (e.g. Attachments and Remarks), so it can't scroll out of sight. */
  pinned?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">{children}</div>
        {pinned && <div className="drawer-pin">{pinned}</div>}
        <div className="drawer-foot">{footer}</div>
      </aside>
    </div>
  );
}

/** POST JSON and return the parsed body, throwing the API's error message on failure. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
  return data as T;
}
