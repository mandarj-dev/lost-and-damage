import { notFound, redirect } from "next/navigation";
import { getActor } from "./auth";
import type { Role } from "./types";

/** For server pages: redirect to sign-in, 404 when the role can't see the page. */
export async function pageActor(...roles: Role[]) {
  const actor = await getActor();
  if (!actor) redirect("/");
  if (roles.length && !roles.includes(actor.role) && actor.role !== "ADMIN") notFound();
  return actor;
}
