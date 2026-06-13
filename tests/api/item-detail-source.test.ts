import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const v1ItemRoute = readFileSync(
  resolve(root, "app/api/v1/items/[id]/route.ts"),
  "utf8",
);
const publicItemRoute = readFileSync(
  resolve(root, "app/api/public/items/[id]/route.ts"),
  "utf8",
);
const itemDetailModule = readFileSync(
  resolve(root, "lib/api/item-detail.ts"),
  "utf8",
);
const publicItemsModule = readFileSync(
  resolve(root, "lib/api/public-items.ts"),
  "utf8",
);
const storyItemFieldsModule = readFileSync(
  resolve(root, "lib/api/story-item-fields.ts"),
  "utf8",
);

describe("item detail route source wiring", () => {
  test("public and v1 detail routes delegate route id parsing, DB lookup, and serialization", () => {
    for (const source of [v1ItemRoute, publicItemRoute]) {
      expect(source).toContain("@/lib/api/item-detail");
      expect(source).toContain("getItemDetailRouteRow");
      expect(source).not.toContain("parseItemDetailRouteId");
      expect(source).not.toContain("getItemDetailRow");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("leftJoin(clusters");
      expect(source).not.toContain("innerJoin(sources");
      expect(source).not.toContain("const idSchema = z.coerce");
    }
    expect(v1ItemRoute).toContain("toV1ItemDetail(found.row)");
    expect(publicItemRoute).toContain("toPublicItemDetail(found.row)");
    expect(publicItemRoute).toContain("publicItemDetailEtagSignal(found.row)");
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
});
