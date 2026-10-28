import { ROLES, type Actor } from "./types";

export const DEV_COOKIE = "ld_dev_user";

/** Demo sandbox ids are 12 hex chars; each one owns a private copy of the tables. */
export const SANDBOX_ID = /^[a-f0-9]{12}$/;

export type DevSession = Actor & { sid: string };

/** Read the dev-login cookie. Returns null unless it holds a valid role and sandbox id. */
export function parseDevCookie(raw?: string): DevSession | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as DevSession;
    return ROLES.includes(a.role) && SANDBOX_ID.test(a.sid ?? "") ? a : null;
  } catch {
    return null;
  }
}

export const newSandboxId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
