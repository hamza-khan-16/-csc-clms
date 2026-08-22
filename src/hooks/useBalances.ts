import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LEAVE_TYPES, eachDate, type LeaveType, type LeaveSession } from "@/lib/leave";

export interface BalanceRow {
  type: LeaveType;
  label: string;
  yearlyCap: number;
  monthlyCap?: number;
  usedYear: number;
  usedMonth: number;
}

export function useBalances(userId: string | undefined) {
  return useQuery({
    queryKey: ["balances", userId],
    enabled: !!userId,
    queryFn: async (): Promise<BalanceRow[]> => {
      const now   = new Date();
      const year  = now.getFullYear();
      const month = now.getMonth();

      const monthFirst = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const monthLast  = new Date(year, month + 1, 0);
      const monthLastISO = `${year}-${String(month + 1).padStart(2, "0")}-${String(monthLast.getDate()).padStart(2, "0")}`;

      // Fetch leave requests AND cl_quota from profile in parallel
      const [{ data, error }, { data: profile }] = await Promise.all([
        supabase
          .from("leave_requests")
          .select("leave_type, from_date, to_date, total_days, session, status")
          .eq("teacher_id", userId!)
          .in("status", ["hod_approved", "approved"])
          .gte("from_date", `${year}-01-01`)
          .lte("from_date", `${year}-12-31`),
        supabase
          .from("profiles")
          .select("cl_quota")
          .eq("id", userId!)
          .maybeSingle(),
      ]);

      if (error) throw error;

      // Use admin-set quota if available, else default from LEAVE_TYPES
      const clQuota: number = (profile as any)?.cl_quota ?? null;

      const allRows = data ?? [];
      const dateCountCache = new Map<string, number>();
      function cachedDateCount(from: string, to: string): number {
        const key = `${from}|${to}`;
        if (!dateCountCache.has(key)) dateCountCache.set(key, eachDate(from, to).length);
        return dateCountCache.get(key)!;
      }

      return LEAVE_TYPES.map((t) => {
        const rows = allRows.filter((r) => r.leave_type === t.value);
        const usedYear = rows.reduce((s, r) => s + Number(r.total_days), 0);

        const usedMonth = rows
          .filter((r) => r.from_date <= monthLastISO && r.to_date >= monthFirst)
          .reduce((s, r) => {
            const clampFrom = r.from_date < monthFirst   ? monthFirst   : r.from_date;
            const clampTo   = r.to_date   > monthLastISO ? monthLastISO : r.to_date;
            const daysInMonth = cachedDateCount(clampFrom, clampTo);
            const totalDays   = Number(r.total_days);
            if (totalDays === 0) return s;
            const fullRange = cachedDateCount(r.from_date, r.to_date);
            const ratio     = fullRange > 0 ? daysInMonth / fullRange : 1;
            return s + totalDays * ratio;
          }, 0);

        // Override casual leave cap if admin has set a quota
        const yearlyCap = (t.value === "casual" && clQuota !== null)
          ? clQuota
          : t.yearly;

        return {
          type:       t.value,
          label:      t.label,
          yearlyCap,
          monthlyCap: t.monthly,
          usedYear,
          usedMonth:  Math.round(usedMonth * 2) / 2,
        };
      });
    },
  });
}
