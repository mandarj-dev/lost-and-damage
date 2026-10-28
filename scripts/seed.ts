/**
 * Load the dummy orders into the LIVE tables (the demo sandbox does this by itself on login).
 *   npm run seed            # adds the dummy orders
 *   npm run seed -- --reset # wipes the L&D tables first (never run against production)
 */
import "./load-env";
import { closeDb, connectDB, q } from "@/lib/db";
import { DEMO_ACTORS, seedDemo } from "@/lib/demo";

async function main() {
  await connectDB();
  if (process.argv.includes("--reset")) {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
    await q("TRUNCATE approvals, timeline_events, settlements, client_cns, courier_cns, cases");
  }
  for (const u of [DEMO_ACTORS.OPS, DEMO_ACTORS.ACCOUNTS, DEMO_ACTORS.MANAGEMENT])
    await q(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role",
      [u.email, u.name, u.role],
    );
  await seedDemo();
  const [n] = await q<{ n: number }>("SELECT count(*)::int AS n FROM cases");
  console.log("Seeded:", n.n, "cases");
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
