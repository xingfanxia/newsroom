import { NextResponse } from "next/server";
import { verifyCron } from "./_auth";

type CronJsonBody = { kind: string } & Record<string, unknown>;

export async function runCronJsonRoute<T extends CronJsonBody>(
  req: Request,
  buildBody: () => Promise<T> | T,
): Promise<Response> {
  const deny = verifyCron(req);
  if (deny) return deny;

  const body = await buildBody();
  const payload: Record<string, unknown> = { ...body };
  delete payload.kind;
  delete payload.at;

  return NextResponse.json({
    kind: body.kind,
    at: new Date().toISOString(),
    ...payload,
  });
}
