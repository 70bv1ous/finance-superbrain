import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Generic base for all event-family memory case stores.
 *
 * Handles the shared infrastructure:
 *   - in-process Map<id, T> storage
 *   - optional JSON file persistence (load / persist)
 *   - save, reset, get, size
 *
 * Subclasses add a `list(filter?)` method that accesses `casesMap` for
 * domain-specific filtering (event fields, family-specific keys, etc.).
 *
 * No Phase 4 infrastructure is touched. The base class is intentionally
 * thin — it does not implement a Repository interface and has no runtime
 * dependencies beyond Node built-ins.
 */
export abstract class BaseMemoryCaseStore<T extends { id: string; created_at: string }> {
  protected readonly casesMap = new Map<string, T>();
  private readonly persistPath: string | null;

  constructor(persistPath?: string | null) {
    this.persistPath = persistPath ?? null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Load previously persisted cases from disk.
   * Safe to call on an empty or non-existent file — starts fresh in that case.
   */
  async load(): Promise<void> {
    if (!this.persistPath) return;

    try {
      const raw = await readFile(this.persistPath, "utf8");
      const data = JSON.parse(raw) as T[];

      for (const item of data) {
        this.casesMap.set(item.id, item);
      }
    } catch {
      // File missing or unreadable — start empty, first save will create it.
    }
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;

    const data = [...this.casesMap.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );

    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(data, null, 2), "utf8");
  }

  // ── Write ────────────────────────────────────────────────────────────────────

  async save(memoryCase: T): Promise<T> {
    this.casesMap.set(memoryCase.id, memoryCase);
    await this.persist();
    return memoryCase;
  }

  async reset(): Promise<void> {
    this.casesMap.clear();
    await this.persist();
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  async get(id: string): Promise<T | null> {
    return this.casesMap.get(id) ?? null;
  }

  get size(): number {
    return this.casesMap.size;
  }
}
