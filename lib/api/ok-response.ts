export function okJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
): Response {
  return Response.json({ ok: true, ...body }, init);
}

export function okEmpty(init?: ResponseInit): Response {
  return Response.json({ ok: true }, init);
}

export function okError(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ ok: false, ...extra, error }, { status });
}
