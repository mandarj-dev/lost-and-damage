import { cookies, headers } from "next/headers";
import { sandboxAlive } from "./db";
import { HttpError } from "./http";
import { DEV_COOKIE, parseDevCookie } from "./session";
import { ROLES, type Actor, type Role } from "./types";

export { DEV_COOKIE };

/**
 * Resolve the signed-in user.
 *
 * TODO(auth): replace with InstaLogix SSO (or NextAuth). The SSO layer should
 * produce the same Actor shape; nothing else in the app needs to change.
 *
 * AUTH_MODE=dev lets you pick a role on the home page (stored in a cookie).
 * Never enable dev mode in production.
 */
export async function getActor(): Promise<Actor | null> {
  if (process.env.AUTH_MODE === "dev") {
    const session = parseDevCookie((await cookies()).get(DEV_COOKIE)?.value);
    // A sandbox that was swept (older than a few hours) means the tester must sign in again.
    return session && (await sandboxAlive(session.sid)) ? session : null;
  }

  // Placeholder for SSO: trusted headers set by the InstaLogix gateway.
  const h = await headers();
  const id = h.get("x-instalogix-user-id");
  const role = h.get("x-instalogix-role") as Role | null;
  if (id && role && ROLES.includes(role) && process.env.TRUST_GATEWAY_HEADERS === "true") {
    return {
      id,
      role,
      name: h.get("x-instalogix-user-name") ?? id,
      email: h.get("x-instalogix-user-email") ?? "",
    };
  }
  return null;
}

export async function requireActor(...roles: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new HttpError(401, "Sign in required");
  if (roles.length && !roles.includes(actor.role) && actor.role !== "ADMIN")
    throw new HttpError(403, `This needs one of: ${roles.join(", ")}`);
  return actor;
}
