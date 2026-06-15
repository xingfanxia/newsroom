import { NextResponse } from "next/server";

export function okJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json({ ok: true, ...body }, init);
}

export function okEmpty(init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true }, init);
}

export function okError(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ ok: false, ...extra, error }, { status });
}
