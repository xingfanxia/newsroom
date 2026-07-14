const DAY_MS = 86_400_000;
export const MINIMUM_PUBLIC_RELEASES = 7;
export const MINIMUM_PUBLIC_RETENTION_DAYS = 30;

export type PublicReleaseInventoryEntry = {
  releaseId: string;
  publishedAt: string;
};

export type PublicRetentionPlan = {
  keepReleaseIds: string[];
  deleteReleaseIds: string[];
  operatorPauseRequired: boolean;
  pauseReasons: Array<
    "active_release_missing" | "previous_release_missing" | "pointer_change_requested"
  >;
  pointerAction: "none";
};

export function planPublicReleaseRetention(input: {
  releases: readonly PublicReleaseInventoryEntry[];
  activeReleaseId: string;
  previousReleaseId: string | null;
  nowMs: number;
  pointerChangeRequested?: boolean;
}): PublicRetentionPlan {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    throw new TypeError("retention clock must be a non-negative integer");
  }
  const releases = input.releases.map((release) => ({
    ...release,
    publishedAtMs: parseTimestamp(release.publishedAt),
  }));
  const ids = new Set<string>();
  for (const release of releases) {
    if (ids.has(release.releaseId)) {
      throw new Error(`duplicate release ID: ${release.releaseId}`);
    }
    ids.add(release.releaseId);
  }

  const pauseReasons: PublicRetentionPlan["pauseReasons"] = [];
  if (!ids.has(input.activeReleaseId)) {
    pauseReasons.push("active_release_missing");
  }
  if (input.previousReleaseId !== null && !ids.has(input.previousReleaseId)) {
    pauseReasons.push("previous_release_missing");
  }
  if (input.pointerChangeRequested === true) {
    pauseReasons.push("pointer_change_requested");
  }
  const ordered = releases.sort(
    (left, right) =>
      right.publishedAtMs - left.publishedAtMs ||
      left.releaseId.localeCompare(right.releaseId),
  );
  if (pauseReasons.length > 0) {
    return {
      keepReleaseIds: ordered.map(({ releaseId }) => releaseId),
      deleteReleaseIds: [],
      operatorPauseRequired: true,
      pauseReasons,
      pointerAction: "none",
    };
  }

  const keep = new Set(
    ordered
      .slice(0, MINIMUM_PUBLIC_RELEASES)
      .map(({ releaseId }) => releaseId),
  );
  const cutoff =
    input.nowMs - MINIMUM_PUBLIC_RETENTION_DAYS * DAY_MS;
  for (const release of ordered) {
    if (release.publishedAtMs >= cutoff) keep.add(release.releaseId);
  }
  keep.add(input.activeReleaseId);
  if (input.previousReleaseId !== null) keep.add(input.previousReleaseId);

  return {
    keepReleaseIds: ordered
      .filter(({ releaseId }) => keep.has(releaseId))
      .map(({ releaseId }) => releaseId),
    deleteReleaseIds: ordered
      .filter(({ releaseId }) => !keep.has(releaseId))
      .map(({ releaseId }) => releaseId),
    operatorPauseRequired: false,
    pauseReasons: [],
    pointerAction: "none",
  };
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError("invalid release time");
  return parsed;
}
