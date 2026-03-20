/**
 * Library Stats
 *
 * Lightweight direct-DB queries for the historical case library dashboard.
 * Returns aggregate stats (case counts by pack) without going through the
 * full repository layer — keeps it fast and avoids loading all case objects.
 */

import pg from "pg";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

export type PackStat = {
  case_pack:   string;
  case_count:  number;
  draft_count: number;
  reviewed_count: number;
  latest_case_at: string | null;
};

/**
 * Returns per-pack case counts from the historical_case_library table.
 * Includes total count, draft vs reviewed breakdown, and the most recent
 * case insertion date.
 */
export async function getLibraryPackStats(): Promise<PackStat[]> {
  try {
    const db  = getPool();
    const res = await db.query<{
      case_pack:      string;
      case_count:     string;
      draft_count:    string;
      reviewed_count: string;
      latest_case_at: string | null;
    }>(
      `SELECT
         case_pack,
         COUNT(*)                                                              AS case_count,
         COUNT(*) FILTER (WHERE labels->>'case_quality' = 'draft')            AS draft_count,
         COUNT(*) FILTER (WHERE labels->>'case_quality' != 'draft')           AS reviewed_count,
         MAX(created_at)                                                       AS latest_case_at
       FROM historical_case_library
       GROUP BY case_pack
       ORDER BY case_pack`
    );

    return res.rows.map(r => ({
      case_pack:      r.case_pack,
      case_count:     parseInt(r.case_count,     10),
      draft_count:    parseInt(r.draft_count,    10),
      reviewed_count: parseInt(r.reviewed_count, 10),
      latest_case_at: r.latest_case_at
        ? (r.latest_case_at instanceof Date
            ? r.latest_case_at.toISOString()
            : r.latest_case_at)
        : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Returns the total case count across all packs.
 */
export async function getTotalCaseCount(): Promise<number> {
  try {
    const db  = getPool();
    const res = await db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM historical_case_library`
    );
    return parseInt(res.rows[0]?.cnt ?? "0", 10);
  } catch {
    return 0;
  }
}
