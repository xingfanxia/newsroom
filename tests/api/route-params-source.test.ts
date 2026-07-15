import { describe, expect, test } from "bun:test";
import {
  INVALID_ROUTE_ID_ERROR,
  parsePositiveRouteId,
} from "@/lib/api/route-params";
import { readSource as read } from "@/tests/helpers/source";

const routeParamsSrc = read("lib/api/route-params.ts");
const itemDetailSrc = read("lib/api/item-detail.ts");
const eventMembersSrc = read("lib/api/event-members.ts");
const eventMemberContractSrc = read("lib/api/event-member-contract.ts");
const iterationsSrc = read("lib/policy/iterations.ts");

describe("route parameter contracts", () => {
  test("positive route ids share one parser and error label", () => {
    expect(INVALID_ROUTE_ID_ERROR).toBe("invalid_id");
    expect(parsePositiveRouteId("42")).toEqual({ ok: true, id: 42 });
    expect(parsePositiveRouteId("001")).toEqual({ ok: true, id: 1 });
    expect(parsePositiveRouteId("0")).toEqual({
      ok: false,
      error: "invalid_id",
    });
    expect(parsePositiveRouteId("abc")).toEqual({
      ok: false,
      error: "invalid_id",
    });

    expect(routeParamsSrc).toContain("export const INVALID_ROUTE_ID_ERROR");
    expect(routeParamsSrc).toContain("export function parsePositiveRouteId");
  });

  test("item, event-member, and iteration route parsers reuse the shared parser", () => {
    for (const source of [itemDetailSrc, eventMemberContractSrc, iterationsSrc]) {
      expect(source).toContain("@/lib/api/route-params");
      expect(source).toContain("parsePositiveRouteId");
      expect(source).not.toContain("z.coerce.number().int().positive()");
      expect(source).not.toContain('{ ok: false, error: "invalid_id" }');
    }
    expect(eventMemberContractSrc).toContain("INVALID_ROUTE_ID_ERROR");
    expect(eventMembersSrc).toContain("parseEventMemberRouteParams");
  });
});
