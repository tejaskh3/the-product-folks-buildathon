// Connection details for local Supabase (`npx supabase start`), or null when it isn't running.
// Database tests use this to skip themselves instead of failing on machines without Docker.
import { execSync } from "node:child_process";

export const localSupabase: { url: string; key: string } | null = (() => {
  try {
    const env = execSync("npx -y supabase@latest status -o env", { stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).toString();
    const get = (k: string) => env.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1];
    const url = get("API_URL");
    const key = get("SERVICE_ROLE_KEY");
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
})();

export function useLocalSupabase() {
  if (!localSupabase) return;
  process.env.SUPABASE_URL = localSupabase.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = localSupabase.key;
}
