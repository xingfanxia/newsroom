import { describe, expect, test } from "bun:test";
import {
  assertFinalProductionDocumentation,
  type FinalProductionDocumentation,
} from "@/scripts/verification/r2-public-criteria";
import {
  FINAL_R2_PUBLIC_CRITERIA,
  renderFinalVerificationReport,
  verifyR2PublicFinal,
} from "@/scripts/verification/r2-public-final";

describe("R2 public final verification", () => {
  test("runs the hermetic repository gate and every frozen criterion in order", async () => {
    const calls: string[] = [];
    const result = await verifyR2PublicFinal("/fixture", {
      runRepositoryGate: async () => {
        calls.push("repository-gate");
        return "hermetic repository gate passed";
      },
      verifyCriterion: async (criterion) => {
        calls.push(criterion);
        return { criterion, ok: true, receipts: [`${criterion} receipt`] };
      },
    });

    expect(FINAL_R2_PUBLIC_CRITERIA).toHaveLength(13);
    expect(calls).toEqual(["repository-gate", ...FINAL_R2_PUBLIC_CRITERIA]);
    expect(result.criteria).toHaveLength(13);
    expect(result.ok).toBeTrue();
  });

  test("fails closed at the first missing criterion instead of writing partial success", async () => {
    const attempted: string[] = [];
    await expect(
      verifyR2PublicFinal("/fixture", {
        runRepositoryGate: async () => "gate passed",
        verifyCriterion: async (criterion) => {
          attempted.push(criterion);
          if (criterion === "AC-004") throw new Error("production receipt missing");
          return { criterion, ok: true, receipts: [] };
        },
      }),
    ).rejects.toThrow("production receipt missing");
    expect(attempted).toEqual(["AC-001", "AC-002", "AC-003", "AC-004"]);
  });

  test("renders one PASS row per criterion only after the complete run", async () => {
    const result = await verifyR2PublicFinal("/fixture", {
      runRepositoryGate: async () => "hermetic repository gate passed",
      verifyCriterion: async (criterion) => ({
        criterion,
        ok: true,
        receipts: [`${criterion} proof`],
      }),
    });
    const report = renderFinalVerificationReport(result, {
      goalVersion: "r2-public-read-v1-ec57c55fe111",
      verifiedAt: "2026-07-14T12:00:00.000Z",
    });
    for (const criterion of FINAL_R2_PUBLIC_CRITERIA) {
      expect(report).toContain(`| ${criterion} | PASS |`);
    }
    expect(report).toContain("Status: **PASS**");
    expect(report).toContain("hermetic repository gate");
  });

  test("requires shipped docs to match measured production totals", () => {
    const measured = {
      totalTursoProjectedMonthlyRows: 9_125_000,
      publisherProjectedMonthlyRows: 1_250_000,
      preferredTargetMet: true,
    };
    const documents: FinalProductionDocumentation = {
      handoff: [
        "R2 public-read decoupling shipped",
        "Total Turso projection: 9,125,000 rows/month",
        "Publisher projection: 1,250,000 rows/month",
        "Preferred <10M/month target: met",
      ].join("\n"),
      operations: [
        "Status: production cutover complete",
        "Total Turso projection: 9,125,000 rows/month",
        "Publisher projection: 1,250,000 rows/month",
        "Preferred <10M/month target: met",
        "48-hour stability receipt",
        "rollback drill receipt",
      ].join("\n"),
    };

    expect(() =>
      assertFinalProductionDocumentation(documents, measured),
    ).not.toThrow();
    expect(() =>
      assertFinalProductionDocumentation(
        { ...documents, handoff: documents.handoff.replace("9,125,000", "9,125,001") },
        measured,
      ),
    ).toThrow("measured total Turso projection");
  });
});
