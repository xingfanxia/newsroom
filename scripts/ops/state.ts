import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type OpsState = {
  updatedAt: string;
};

export function opsStatePath(filename: string): string {
  return path.resolve(process.cwd(), "scripts/ops", filename);
}

export async function loadOpsState<T extends OpsState>({
  resume,
  file,
  empty,
  normalize,
  onMissing,
}: {
  resume: boolean;
  file: string;
  empty: () => T;
  normalize: (parsed: Partial<T>, empty: T) => T;
  onMissing?: (file: string) => void;
}): Promise<T> {
  const emptyState = empty();
  if (!resume) return emptyState;

  try {
    const raw = await readFile(file, "utf8");
    return normalize(JSON.parse(raw) as Partial<T>, emptyState);
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      onMissing?.(file);
      return emptyState;
    }
    throw err;
  }
}

export async function saveOpsState<T extends OpsState>(
  file: string,
  state: T,
): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
