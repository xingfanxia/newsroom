import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadOpsState,
  opsStatePath,
  saveOpsState,
} from "@/scripts/ops/state";
import { readSource } from "@/tests/helpers/source";

type TestState = {
  done: number[];
  updatedAt: string;
};

function emptyState(): TestState {
  return { done: [], updatedAt: "empty" };
}

function normalizeState(
  parsed: Partial<TestState>,
  empty: TestState,
): TestState {
  return {
    done: parsed.done ?? [],
    updatedAt: parsed.updatedAt ?? empty.updatedAt,
  };
}

describe("ops resumable state helper", () => {
  test("keeps state paths under scripts/ops", () => {
    expect(opsStatePath("example-state.json")).toBe(
      join(process.cwd(), "scripts/ops/example-state.json"),
    );
  });

  test("does not touch disk when resume is false", async () => {
    const state = await loadOpsState({
      resume: false,
      file: "/definitely/missing/state.json",
      empty: emptyState,
      normalize: normalizeState,
    });

    expect(state).toEqual({ done: [], updatedAt: "empty" });
  });

  test("returns empty state and calls onMissing for missing resume files", async () => {
    const missing: string[] = [];
    const state = await loadOpsState({
      resume: true,
      file: "/definitely/missing/state.json",
      empty: emptyState,
      normalize: normalizeState,
      onMissing: (file) => missing.push(file),
    });

    expect(state).toEqual({ done: [], updatedAt: "empty" });
    expect(missing).toEqual(["/definitely/missing/state.json"]);
  });

  test("normalizes partial JSON state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "newsroom-ops-state-"));
    const file = join(dir, "state.json");
    try {
      await writeFile(file, JSON.stringify({ done: [1, 2, 3] }), "utf8");

      const state = await loadOpsState({
        resume: true,
        file,
        empty: emptyState,
        normalize: normalizeState,
      });

      expect(state).toEqual({ done: [1, 2, 3], updatedAt: "empty" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("saves pretty JSON with a refreshed updatedAt timestamp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "newsroom-ops-state-"));
    const file = join(dir, "state.json");
    try {
      const state = { done: [7], updatedAt: "old" };
      await saveOpsState(file, state);

      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as TestState;

      expect(raw.endsWith("\n")).toBe(true);
      expect(parsed.done).toEqual([7]);
      expect(parsed.updatedAt).not.toBe("old");
      expect(new Date(parsed.updatedAt).toString()).not.toBe("Invalid Date");
      expect(state.updatedAt).toBe(parsed.updatedAt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("backfill scripts source wiring", () => {
  test("share resumable state load/save plumbing", () => {
    for (const rel of [
      "scripts/ops/backfill-style.ts",
      "scripts/ops/backfill-chinese.ts",
      "scripts/ops/backfill-daily-columns.ts",
    ]) {
      const source = readSource(rel);

      expect(source).toContain("@/scripts/ops/state");
      expect(source).toContain("loadOpsState");
      expect(source).toContain("saveOpsState");
      expect(source).toContain("opsStatePath");
      expect(source).not.toContain("node:fs/promises");
      expect(source).not.toContain("path.resolve(");
      expect(source).not.toContain("JSON.parse(raw) as Partial");
      expect(source).not.toContain("JSON.stringify(state, null, 2)");
    }
  });
});
