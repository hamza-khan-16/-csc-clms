/**
 * haptics.ts
 * Thin wrapper around Median's haptics bridge.
 * Falls back to the Web Vibration API in browsers, silently no-ops elsewhere.
 *
 * Usage:
 *   import { haptic } from "@/lib/haptics";
 *   haptic("success");   // after approve/confirm
 *   haptic("warning");   // after reject/decline
 *   haptic("light");     // subtle tap (button press)
 */

type HapticStyle = "light" | "medium" | "heavy" | "success" | "warning" | "error";

export function haptic(style: HapticStyle = "light"): void {
  if (typeof window === "undefined") return;
  const win = window as any;

  // Median bridge — available on all Median plans
  if (win.median?.haptics?.impact) {
    win.median.haptics.impact({ style });
    return;
  }
  if (win.gonative?.haptics?.impact) {
    win.gonative.haptics.impact({ style });
    return;
  }

  // Web Vibration API fallback (Android Chrome browser)
  if ("vibrate" in navigator) {
    const patterns: Record<HapticStyle, number | number[]> = {
      light:   30,
      medium:  50,
      heavy:   80,
      success: [30, 40, 30],
      warning: [50, 30, 50],
      error:   [80, 40, 80],
    };
    navigator.vibrate(patterns[style]);
  }
}
