import type { CanonicalPublicState } from "@/lib/public-content/contracts";

export const PUBLIC_ENTITY_TYPES = [
  "item",
  "event",
  "source",
  "newsletter",
  "policy",
] as const;

export type PublicEntityType = (typeof PUBLIC_ENTITY_TYPES)[number];

type PublicItem = CanonicalPublicState["items"][number];
type PublicEvent = CanonicalPublicState["events"][number];
type PublicSource = CanonicalPublicState["sources"][number];
type PublicNewsletter = CanonicalPublicState["newsletters"][number];
type PublicPolicy = CanonicalPublicState["policies"][number];

export type PublicEntityChange =
  | { entityType: "item"; entityKey: string; value: PublicItem | null }
  | { entityType: "event"; entityKey: string; value: PublicEvent | null }
  | { entityType: "source"; entityKey: string; value: PublicSource | null }
  | {
      entityType: "newsletter";
      entityKey: string;
      value: PublicNewsletter | null;
    }
  | { entityType: "policy"; entityKey: string; value: PublicPolicy | null };

export type PublisherSourceTelemetry = {
  candidateRows: number;
  dedupedEntities: number;
  returnedRows: number;
  scannedRows: number;
  scanMeasurementKind: "plan_upper_bound";
  queryCount: number;
  verifiedPlans: string[];
};

export type PublisherSourceBatch = {
  fromWatermark: number;
  toWatermark: number;
  changes: PublicEntityChange[];
  telemetry: PublisherSourceTelemetry;
};

export type PublisherSourceCaps = {
  maxOutboxRows: number;
  maxEntityKeys: number;
  maxDependentRows: number;
};

export const DEFAULT_PUBLISHER_SOURCE_CAPS = {
  maxOutboxRows: 500,
  maxEntityKeys: 500,
  maxDependentRows: 5_000,
} as const satisfies PublisherSourceCaps;

export interface PublicContentPublisherSource {
  readBatch(fromWatermark: number): Promise<PublisherSourceBatch>;
  acknowledgeThrough(highWater: number): Promise<void>;
}

export class PublisherSourceLimitError extends Error {
  constructor(
    public readonly dimension: keyof PublisherSourceCaps,
    public readonly observed: number,
    public readonly limit: number,
  ) {
    super(`publisher source ${dimension} cap exceeded: ${observed} > ${limit}`);
    this.name = "PublisherSourceLimitError";
  }
}
