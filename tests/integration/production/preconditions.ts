export function assertProductionPrecondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(`Production integration precondition failed: ${message}`);
  }
}

export function requireProductionFixture<T>(
  value: T | null | undefined,
  message: string,
): T {
  assertProductionPrecondition(value !== null && value !== undefined, message);
  return value;
}
