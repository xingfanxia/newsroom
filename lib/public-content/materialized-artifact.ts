import { publicSnapshotReader } from "@/lib/public-content/reader";
import type { AppLocale } from "@/lib/types";

export const materializedPageLogicalName = {
  home: (locale: AppLocale) => `views/home/${locale}`,
  all: (locale: AppLocale) => `views/all/${locale}`,
  curated: (locale: AppLocale) => `views/curated/${locale}`,
  sources: "views/sources",
  podcasts: (locale: AppLocale) => `views/podcasts/${locale}`,
  xMonitor: (locale: AppLocale) => `views/x-monitor/${locale}`,
  daily: (locale: AppLocale) => `views/daily/${locale}`,
  agents: "views/agents",
  podcastDetail: (id: number) => `views/podcast-detail/${id}`,
} as const;

export const REQUIRED_MATERIALIZED_PAGE_LOGICAL_NAMES = [
  materializedPageLogicalName.home("en"),
  materializedPageLogicalName.home("zh"),
  materializedPageLogicalName.all("en"),
  materializedPageLogicalName.all("zh"),
  materializedPageLogicalName.curated("en"),
  materializedPageLogicalName.curated("zh"),
  materializedPageLogicalName.sources,
  materializedPageLogicalName.podcasts("en"),
  materializedPageLogicalName.podcasts("zh"),
  materializedPageLogicalName.xMonitor("en"),
  materializedPageLogicalName.xMonitor("zh"),
  materializedPageLogicalName.daily("en"),
  materializedPageLogicalName.daily("zh"),
  materializedPageLogicalName.agents,
] as const;

export type MaterializedPageArtifact<T = unknown> = {
  schemaVersion: 1;
  model: T;
};

export function materializedPageArtifact<T>(
  model: T,
): MaterializedPageArtifact<T> {
  return { schemaVersion: 1, model };
}

export function parseMaterializedPageArtifact<T = unknown>(
  bytes: Uint8Array,
): MaterializedPageArtifact<T> {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 1 ||
    !("model" in value)
  ) {
    throw new Error("invalid materialized page artifact");
  }
  return value as MaterializedPageArtifact<T>;
}

export async function readMaterializedPageModel<T>(
  logicalName: string,
): Promise<T | null> {
  try {
    const artifact = await publicSnapshotReader().readLogicalArtifact(logicalName);
    return artifact ? parseMaterializedPageArtifact<T>(artifact.bytes).model : null;
  } catch {
    // A release created before materialized views (or a corrupt derived object)
    // can safely fall back to the canonical snapshot path during migration.
    return null;
  }
}
