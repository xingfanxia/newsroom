import { SOURCE_GROUPS, type SourceGroup } from "@/lib/types";

export { SOURCE_GROUPS };

export type SourceGroupLabel = {
  en: string;
  zh: string;
};

export const SOURCE_GROUP_LABELS: Record<SourceGroup, SourceGroupLabel> = {
  "vendor-official": { en: "vendor official", zh: "官网" },
  media: { en: "media", zh: "媒体" },
  newsletter: { en: "newsletter", zh: "通讯" },
  research: { en: "research", zh: "研究" },
  social: { en: "social", zh: "社交" },
  product: { en: "product", zh: "产品" },
  podcast: { en: "podcast", zh: "播客" },
  policy: { en: "policy", zh: "政策" },
  market: { en: "market", zh: "市场" },
};
