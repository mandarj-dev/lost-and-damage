"use client";
import { useRef, useState } from "react";
import { fileKind } from "@/lib/case-view";
import { fileSize } from "@/lib/format";

export type Uploaded = { url: string; name: string; size: number; contentType?: string };

const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "message/rfc822"];

/**
 * Drop zone with the uploaded files listed underneath, as in the Figma "Attachments" block.
 * Files go to /api/upload (Vercel Blob) as soon as they are chosen.
 */
export function FileDrop({
  files, onChange, max = 5, required, title = "Attachments", help, accept = "application/pdf,image/jpeg,image/png",
}: {
  files: Uploaded[];
  onChange: (f: Uploaded[]) => void;
  max?: number;
  required?: boolean;
  title?: string;
  help?: string;
  accept?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const full = files.length >= max;

  async function add(list: FileList | File[]) {
    setError(null);
    const picked = Array.from(list);
    if (files.length + picked.length > max) return setError(`You can attach up to ${max} files.`);
    const next = [...files];
    for (const f of picked) {
      if (f.size > MAX_BYTES) return setError(`${f.name} is over 10 MB.`);
      if (f.type && !OK_TYPES.includes(f.type)) return setError(`${f.name}: only PDF, JPEG and PNG files are allowed.`);
      setBusy((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        next.push({ url: data.url, name: data.name, size: data.size, contentType: data.contentType });
        onChange([...next]);
      } catch (e) {
        setError((e as Error).message);
        break;
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div className="sect" style={{ margin: 0 }}>
          {title}
          {required && <span className="req">Required</span>}
        </div>
        <div className="note-sm">PDF, JPEG, PNG · 10 MB each · up to {max}</div>
      </div>
      {!full && (
        <div
          className={`drop${over ? " over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ color: "var(--teal)", marginBottom: 4 }} aria-hidden>
            <path d="M8 11V3M5 6l3-3 3 3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="big"><b>Choose files</b> or drop them here</div>
          {help && <div className="small">{help}</div>}
          <input
            ref={input}
            type="file"
            multiple
            accept={accept}
            hidden
            onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }}
          />
        </div>
      )}
      {busy > 0 && <div className="note-sm" style={{ marginTop: 8 }}>Uploading…</div>}
      {error && <div className="errline" style={{ marginTop: 8 }}>{error}</div>}
      {files.length > 0 && (
        <div className="files">
          {files.map((f, i) => (
            <div key={f.url} className="fileline">
              <span className={`ftype ${fileKind(f.name)}`}>{fileKind(f.name)}</span>
              <span>{f.name}</span>
              <span className="sz">· {fileSize(f.size)}</span>
              <button type="button" className="x" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
