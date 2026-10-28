// Local database for development without Neon: an in-process Postgres (PGlite) behind a TCP socket.
//   npm run dev:db       (keep it running)
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable PG_POOL_MAX=1 AUTH_MODE=dev npm run dev
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.PORT ?? 54329);
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();
console.log(`PGlite listening on 127.0.0.1:${port}`);
console.log(`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
process.on("SIGINT", async () => { await server.stop(); await db.close(); process.exit(0); });