import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(CURRENT_DIR, "..", "..");
const WORKSPACE_ROOT = resolve(API_ROOT, "..", "..");

export const PHASE1_SCHEMA_PATH = resolve(API_ROOT, "sql", "001_phase1_intelligence_core.sql");
export const DEFAULT_PGLITE_DATA_DIR = resolve(
  WORKSPACE_ROOT,
  ".pglite",
  "finance-superbrain",
);

export const loadPhase1SchemaSql = () => readFile(PHASE1_SCHEMA_PATH, "utf8");

const normalizePGlitePath = (value: string) => value.replaceAll("\\", "/");

export const resolvePGliteDataDir = (input = process.env.PGLITE_DATA_DIR) => {
  if (!input?.trim()) {
    return normalizePGlitePath(DEFAULT_PGLITE_DATA_DIR);
  }

  return normalizePGlitePath(isAbsolute(input) ? input : resolve(WORKSPACE_ROOT, input));
};
