import { supabase } from "@/integrations/supabase/client";

export interface PersonLite {
  id: string;
  full_name: string;
  designation: string;
  department_id: string | null;
  department_name: string | null;
}

export async function fetchPeople(ids: string[]): Promise<Record<string, PersonLite>> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, designation, department_id, departments(name)")
    .in("id", unique);
  if (error) throw error;
  const map: Record<string, PersonLite> = {};
  for (const p of data ?? []) {
    map[p.id] = {
      id: p.id,
      full_name: p.full_name,
      designation: p.designation,
      department_id: p.department_id,
      department_name: (p.departments as { name: string } | null)?.name ?? null,
    };
  }
  return map;
}
