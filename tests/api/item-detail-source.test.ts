import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const v1ItemRoute = readSource("app/api/v1/items/[id]/route.ts");
const publicItemRoute = readSource("app/api/public/items/[id]/route.ts");
const mcpRoute = readSource("app/api/mcp/route.ts");
const itemDetailModule = readSource("lib/api/item-detail.ts");
const publicItemsModule = readSource("lib/api/public-items.ts");
const storyItemFieldsModule = readSource("lib/api/story-item-fields.ts");

describe("item detail route source wiring", () => {
  test("public detail route delegates route id parsing, DB lookup, and serialization", () => {
    expect(publicItemRoute).toContain("@/lib/api/item-detail");
    expect(publicItemRoute).toContain("getItemDetailRouteRow");
    expect(publicItemRoute).not.toContain("parseItemDetailRouteId");
    expect(publicItemRoute).not.toContain("getItemDetailRow");
    expect(publicItemRoute).not.toContain(".select({");
    expect(publicItemRoute).not.toContain("leftJoin(clusters");
    expect(publicItemRoute).not.toContain("innerJoin(sources");
    expect(publicItemRoute).not.toContain("const idSchema = z.coerce");
    expect(publicItemRoute).toContain("toPublicItemDetail(found.row)");
    expect(publicItemRoute).toContain("publicItemDetailEtagSignal(found.row)");
  });

  test("bearer agent item detail surfaces share the v1 payload helper", () => {
    for (const source of [v1ItemRoute, mcpRoute]) {
      expect(source).toContain("@/lib/api/item-detail");
      expect(source).toContain("getAgentItemDetailRoutePayload");
      expect(source).not.toContain("parseItemDetailRouteId");
      expect(source).not.toContain("getItemDetailRow");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("leftJoin(clusters");
      expect(source).not.toContain("innerJoin(sources");
      expect(source).not.toContain("toV1ItemDetail(found.row)");
    }
    expect(mcpRoute).not.toContain("@/lib/items/detail");
    expect(mcpRoute).not.toContain("getItemDetail(id");
    expect(mcpRoute).not.toContain("body_md: detail.bodyMd");
  });

  test("public HKR stripping is shared by list and detail serializers", () => {
    expect(storyItemFieldsModule).toContain("export function toPublicHkr");
    expect(itemDetailModule).toContain(
      "import { toPublicHkr, type PublicHkr }",
    );
    expect(publicItemsModule).toContain("toPublicHkr");
    expect(itemDetailModule).not.toContain("function publicHkr");
    expect(publicItemsModule).not.toContain("function toPublicHkr");
  });

  test("detail serializers reuse the shared nullable ISO helper", () => {
    expect(itemDetailModule).toContain("@/lib/time/relative");
    expect(itemDetailModule).toContain("toIsoStringOrNull");
    expect(itemDetailModule).not.toContain("function iso(");
    expect(itemDetailModule).not.toContain("?.toISOString() ?? null");
  });
});
