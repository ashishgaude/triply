import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  typeof url === "string" &&
  /^https?:\/\//.test(url) &&
  typeof key === "string" &&
  key.length > 0 &&
  !key.startsWith("your_");

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      db: { schema: "triply" },
      auth: { storageKey: "triply-auth", flowType: "pkce" },
    })
  : null;
