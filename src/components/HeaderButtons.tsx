"use client";
import { useState } from "react";
import { MarkCaseDrawer } from "./SmallDrawers";

export function MarkCaseButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>+ Mark case</button>
      {open && <MarkCaseDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
