import { Pool } from "pg";

import { createPGliteRepository } from "../lib/PGliteRepository.js";
import { loadPhase1SchemaSql, resolvePGliteDataDir } from "../lib/schema.js";

const backend =
  process.env.REPOSITORY_BACKEND ??
  (process.env.DATABASE_URL ? "postgres" : process.env.PGLITE_DATA_DIR ? "pglite" : "memory");
const sql = await loadPhase1SchemaSql();

try {
  if (backend === "postgres") {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when REPOSITORY_BACKEND=postgres.");
    }

    const pool = new Pool({
      connectionString: databaseUrl,
    });

    try {
      await pool.query(sql);
      console.log("Phase 1 schema migration applied to Postgres.");
    } finally {
      await pool.end();
    }
  }

  if (backend === "pglite") {
    const dataDir = resolvePGliteDataDir();
    const repository = createPGliteRepository(dataDir);

    try {
      await repository.listLessons();
      console.log(`Phase 1 schema migration applied to PGlite at ${dataDir}.`);
    } finally {
      await repository.close?.();
    }
  }

  if (backend !== "postgres" && backend !== "pglite") {
    throw new Error(
      "Set REPOSITORY_BACKEND to postgres or pglite before running migrations.",
    );
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
