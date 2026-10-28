// Load .env.local / .env for scripts (Next.js does this automatically for the app).
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
