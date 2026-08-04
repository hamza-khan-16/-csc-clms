import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leave";

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
      const year = new Date().getFullYear();
      const { data, error } = await supabase
        .from("leave_requests")
        .select("leave_type, from_date, total_days, status")
        .eq("teacher_id", userId!)
        .in("status", ["hod_recommended", "pending_principal", "hod_approved", "approved"])
        .gte("from_date", `${year}-01-01`)
        .lte("from_date", `${year}-12-31`);
      if (error) throw error;

      const month = new Date().getMonth();
      return LEAVE_TYPES.map((t) => {
        const rows = (data ?? []).filter((r) => r.leave_type === t.value);
        const usedYear = rows.reduce((s, r) => s + Number(r.total_days), 0);
        const usedMonth = rows
          .filter((r) => new Date(r.from_date + "T00:00:00").getMonth() === month)
          .reduce((s, r) => s + Number(r.total_days), 0);
        return {
          type: t.value,
          label: t.label,
          yearlyCap: t.yearly,
          monthlyCap: t.monthly,
          usedYear,
          usedMonth,
        };
      });
    },
  });
}
