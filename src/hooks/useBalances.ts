import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LEAVE_TYPES, eachDate, type LeaveType, type LeaveSession } from "@/lib/leave";

export interface BalanceRow {
  type: LeaveType;
  label: string;
  yearlyCap: number;
  monthlyCap?: number;
  usedYear: number;   // approved days taken this year
  usedMonth: number;  // approved days falling in the current calendar month
}

export function useBalances(userId: string | undefined) {
  return useQuery({
    queryKey: ["balances", userId],
    enabled: !!userId,
    queryFn: async (): Promise<BalanceRow[]> => {
      const now   = new Date();
      const year  = now.getFullYear();
      const month = now.getMonth(); // 0-indexed

      // First day and last day of current month as ISO strings
      const monthFirst = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const monthLast  = new Date(year, month + 1, 0);
      const monthLastISO = `${year}-${String(month + 1).padStart(2, "0")}-${String(monthLast.getDate()).padStart(2, "0")}`;

      // Only fully approved leaves count toward balance
      const { data, error } = await supabase
        .from("leave_requests")
        .select("leave_type, from_date, to_date, total_days, session, status")
        .eq("teacher_id", userId!)
        .in("status", ["hod_approved", "approved"])
        .gte("from_date", `${year}-01-01`)
        .lte("from_date", `${year}-12-31`);

      if (error) throw error;

      // Pre-compute date counts once per leave row so eachDate() isn't
      // called repeatedly inside reduce() on every render (#8)
      const allRows = data ?? [];
      const dateCountCache = new Map<string, number>();
      function cachedDateCount(from: string, to: string): number {
        const key = `${from}|${to}`;
        if (!dateCountCache.has(key)) dateCountCache.set(key, eachDate(from, to).length);
        return dateCountCache.get(key)!;
      }

      return LEAVE_TYPES.map((t) => {
        const rows = allRows.filter((r) => r.leave_type === t.value);

        // Yearly total — straightforward sum of approved total_days
        const usedYear = rows.reduce((s, r) => s + Number(r.total_days), 0);

        // Monthly total — count only days that actually fall within this month.
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

        return {
          type:       t.value,
          label:      t.label,
          yearlyCap:  t.yearly,
          monthlyCap: t.monthly,
          usedYear,
          usedMonth:  Math.round(usedMonth * 2) / 2, // round to nearest 0.5
        };
      });
    },
  });
}
