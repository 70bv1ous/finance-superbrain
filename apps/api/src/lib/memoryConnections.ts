import { memoryConnectionsResponseSchema, type MemoryConnection, type MemoryConnectionNode } from "@finance-superbrain/schemas";

import type { PredictionLearningRecord, Repository } from "./repository.types.js";

type ConnectionBucket = {
  signal: "asset" | "theme";
  label: string;
  nodes: Map<string, MemoryConnectionNode>;
  reason_codes: Set<string>;
};

function normalizeConnectionToken(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function displayConnectionToken(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function splitMetadataList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function addConnectionNode(
  buckets: Map<string, ConnectionBucket>,
  input: {
    signal: "asset" | "theme";
    value: string;
    node: MemoryConnectionNode;
  },
) {
  const normalized = normalizeConnectionToken(input.value);
  if (!normalized) {
    return;
  }

  const key = `${input.signal}:${normalized}`;
  const bucket =
    buckets.get(key) ??
    {
      signal: input.signal,
      label: displayConnectionToken(input.value),
      nodes: new Map<string, MemoryConnectionNode>(),
      reason_codes: new Set<string>(),
    };

  const nodeKey = `${input.node.kind}:${input.node.id}`;
  const existing = bucket.nodes.get(nodeKey);
  const reasonCodes = new Set([...(existing?.reason_codes ?? []), ...input.node.reason_codes]);
  bucket.nodes.set(nodeKey, {
    ...input.node,
    reason_codes: [...reasonCodes].sort(),
  });
  for (const reasonCode of input.node.reason_codes) {
    bucket.reason_codes.add(reasonCode);
  }
  buckets.set(key, bucket);
}

function lessonNodeFromRecord(record: PredictionLearningRecord): MemoryConnectionNode | null {
  const lesson = record.lesson;
  if (!lesson) {
    return null;
  }

  const importedFromObsidian = lesson.metadata.imported_from === "obsidian" || lesson.metadata.import_mode === "selective_human_inbox";
  return {
    id: lesson.id,
    kind: "lesson",
    title: lesson.lesson_summary,
    summary: lesson.lesson_summary,
    href: `/predictions/${lesson.prediction_id}`,
    updated_at: lesson.created_at,
    reason_codes: importedFromObsidian ? ["imported_obsidian_memory", "lesson_memory"] : ["lesson_memory"],
  };
}

export async function buildMemoryConnections(repository: Repository, limit = 24) {
  const workspace = await repository.getOrCreateDefaultWorkspace();
  const [decisionBriefs, portfolioCandidates, learningRecords] = await Promise.all([
    repository.listDecisionBriefs({
      workspace_id: workspace.id,
      limit: 512,
    }),
    repository.listPortfolioCandidates({
      workspace_id: workspace.id,
      limit: 512,
    }),
    repository.listLearningRecords(),
  ]);
  const buckets = new Map<string, ConnectionBucket>();

  for (const brief of decisionBriefs) {
    const node: MemoryConnectionNode = {
      id: brief.id,
      kind: "decision_brief",
      title: brief.title,
      summary: brief.summary,
      href: `/decisions/${brief.id}`,
      updated_at: brief.updated_at,
      reason_codes: ["decision_key_asset"],
    };

    for (const asset of brief.key_assets) {
      addConnectionNode(buckets, { signal: "asset", value: asset, node });
    }
  }

  for (const candidate of portfolioCandidates) {
    const baseNode: Omit<MemoryConnectionNode, "reason_codes"> = {
      id: candidate.id,
      kind: "portfolio_candidate",
      title: candidate.title,
      summary: candidate.summary,
      href: `/portfolio/${candidate.id}`,
      updated_at: candidate.updated_at,
    };

    for (const asset of candidate.related_assets) {
      addConnectionNode(buckets, {
        signal: "asset",
        value: asset,
        node: { ...baseNode, reason_codes: ["portfolio_related_asset"] },
      });
    }
    for (const theme of [candidate.primary_theme, ...candidate.secondary_themes]) {
      addConnectionNode(buckets, {
        signal: "theme",
        value: theme,
        node: { ...baseNode, reason_codes: ["portfolio_theme"] },
      });
    }
  }

  for (const record of learningRecords) {
    const node = lessonNodeFromRecord(record);
    if (!node || !record.lesson) {
      continue;
    }

    for (const asset of [...record.event.candidate_assets, ...splitMetadataList(record.lesson.metadata.assets)]) {
      addConnectionNode(buckets, { signal: "asset", value: asset, node });
    }
    for (const theme of [
      ...record.event.themes,
      ...splitMetadataList(record.lesson.metadata.themes),
      ...splitMetadataList(record.lesson.metadata.tags),
    ]) {
      addConnectionNode(buckets, { signal: "theme", value: theme, node });
    }
  }

  const connections: MemoryConnection[] = [...buckets.entries()]
    .map(([key, bucket]) => {
      const nodes = [...bucket.nodes.values()].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
      const reasonCodes = [...bucket.reason_codes].sort();
      return {
        key,
        signal: bucket.signal,
        label: bucket.label,
        title: `${bucket.signal === "asset" ? "Asset" : "Theme"} connection: ${bucket.label}`,
        summary: `${nodes.length} workspace memories share ${bucket.signal} "${bucket.label}".`,
        reason_codes: reasonCodes,
        nodes,
        updated_at: nodes[0]?.updated_at ?? workspace.updated_at,
      };
    })
    .filter((connection) => connection.nodes.length >= 2)
    .sort((left, right) => {
      const countDelta = right.nodes.length - left.nodes.length;
      return countDelta !== 0 ? countDelta : Date.parse(right.updated_at) - Date.parse(left.updated_at);
    })
    .slice(0, Math.max(1, Math.min(Math.trunc(limit), 50)));

  return memoryConnectionsResponseSchema.parse({
    connections,
    generated_at: new Date().toISOString(),
  });
}
