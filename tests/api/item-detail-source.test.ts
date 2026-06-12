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

describe("item detail route source wiring", () => {
  test("public and v1 detail routes delegate DB lookup and serialization", () => {
    for (const source of [v1ItemRoute, publicItemRoute]) {
      expect(source).toContain("@/lib/api/item-detail");
      expect(source).toContain("getItemDetailRow");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("leftJoin(clusters");
      expect(source).not.toContain("innerJoin(sources");
    }
    expect(v1ItemRoute).toContain("toV1ItemDetail(row)");
    expect(publicItemRoute).toContain("toPublicItemDetail(row)");
    expect(publicItemRoute).toContain("publicItemDetailEtagSignal(row)");
  });
});
