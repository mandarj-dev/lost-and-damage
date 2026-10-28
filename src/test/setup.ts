// Integration tests run against a real Postgres (PGlite, in-process) behind a TCP socket, so the
// production code path (node-postgres, SQL, transactions) is exercised exactly as on Vercel.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export default async function setup() {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 54329, host: "127.0.0.1" });
  await server.start();
  process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable";
  process.env.PG_POOL_MAX = "1";
  return async () => {
    await server.stop();
    await db.close();
  };
}