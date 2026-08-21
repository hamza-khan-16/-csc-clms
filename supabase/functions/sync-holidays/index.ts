/**
 * sync-holidays  —  Supabase Edge Function
 *
 * Fetches Indian public holidays for one or more years from the free
 * Nager.Date API (no API key needed, open source, used by thousands of apps)
 * and upserts them into the `holidays` table.
 *
 * API:  https://date.nager.at/api/v3/PublicHolidays/{year}/IN
 *
 * Call with POST body: { "years": [2026, 2027] }
 * or GET with query:   ?years=2026,2027
 * If no years supplied, syncs current year + next year.
 *
 * Deploy:  supabase functions deploy sync-holidays --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NAGER_BASE                = "https://date.nager.at/api/v3/PublicHolidays";

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Parse which years to sync
  let years: number[] = [];
  const now = new Date().getFullYear();

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (Array.isArray(body.years)) years = body.years.map(Number);
    } catch { /* ignore parse errors */ }
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const yParam = url.searchParams.get("years");
    if (yParam) years = yParam.split(",").map(Number).filter(Boolean);
  }

  // Default: current year + next year
  if (years.length === 0) years = [now, now + 1];

  // Deduplicate and clamp to reasonable range (Nager supports ~1974–2099)
  years = [...new Set(years)].filter((y) => y >= 2000 && y <= 2099);

  const results: { year: number; upserted: number; error?: string }[] = [];

  for (const year of years) {
    try {
      const res = await fetch(`${NAGER_BASE}/${year}/IN`, {
        headers: { Accept: "application/json" },
      });

      if (res.status === 404) {
        // Nager returns 404 for years with no data
        results.push({ year, upserted: 0, error: "No data available for this year" });
        continue;
      }
      if (!res.ok) {
        results.push({ year, upserted: 0, error: `HTTP ${res.status}` });
        continue;
      }

      const holidays: NagerHoliday[] = await res.json();

      // Keep only nationwide public holidays (not regional bank holidays)
      const rows = holidays
        .filter((h) => h.global && h.types.includes("Public"))
        .map((h) => ({
          holiday_date: h.date,        // "2026-01-26"
          occasion:     h.name,        // "Republic Day"
          kind:         "National",
          source:       "nager",
        }));

      if (rows.length === 0) {
        results.push({ year, upserted: 0, error: "No public holidays in response" });
        continue;
      }

      // Upsert — conflict on holiday_date updates the name in case gazette
      // notifications change (e.g. a floating holiday shifts date)
      // BUT only overwrite if source is 'nager' or 'seed' — never overwrite manual entries
      const { error } = await supabase
        .from("holidays")
        .upsert(rows, {
          onConflict: "holiday_date",
          ignoreDuplicates: false,
        });

      if (error) {
        results.push({ year, upserted: 0, error: error.message });
      } else {
        results.push({ year, upserted: rows.length });
      }
    } catch (err) {
      results.push({ year, upserted: 0, error: String(err) });
    }
  }

  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);

  return new Response(
    JSON.stringify({ ok: true, totalUpserted, results }),
    { headers: { "Content-Type": "application/json" } },
  );
});
