import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (what = "Not found") => new HttpError(404, what);
export const forbidden = (msg = "You can't do this on this case.") => new HttpError(403, msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);

/** Wrap a route handler so thrown errors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError)
        return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      const pg = e as { code?: string; constraint?: string };
      if (pg?.code === "22P02") return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      if (pg?.code === "23505")
        return NextResponse.json({ error: "Duplicate value", details: { constraint: pg.constraint } }, { status: 409 });
      console.error(e);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
