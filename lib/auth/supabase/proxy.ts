import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "../config";

/**
 * Supabase client for Next 16 `proxy.ts` usage. Returns both the client and
 * the response object; callers must use the returned response so refreshed
 * cookies reach the browser.
 *
 * Pattern:
 *   const { client, response } = createSupabaseProxy(request);
 *   const { data: { user } } = await client.auth.getUser();
 *   ...
 *   return response;
 */
export function createSupabaseProxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const client = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { client, response };
}
