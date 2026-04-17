import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "../config";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 *
 * Reads cookies from next/headers; writes cookies back when Supabase rotates
 * the session. The try/catch around setAll swallows the "cookies may not be
 * set from a Server Component" error — that's expected when this client is
 * used inside RSC rendering, and the proxy will refresh the cookie on the
 * next navigation.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op: invoked from a Server Component that cannot mutate cookies.
        }
      },
    },
  });
}
