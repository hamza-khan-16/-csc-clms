/**
 * haptics.ts
 * Thin wrapper around Median's haptics bridge.
 * Falls back to the Web Vibration API in browsers, silently no-ops elsewhere.
 *
 * Median bridge reference: median.haptics.vibrate({ style })
 * Style values (Median): impactLight, impactMedium, impactHeavy,
 *                        notificationSuccess, notificationWarning, notificationError
 *
 * Usage:
 *   import { haptic } from "@/lib/haptics";
 *   haptic("success");   // after approve/confirm
 *   haptic("warning");   // after reject/decline
 *   haptic("light");     // subtle tap (button press)
 */

type HapticStyle = "light" | "medium" | "heavy" | "success" | "warning" | "error";

// Map our simple style names to Median's style strings
const MEDIAN_STYLE: Record<HapticStyle, string> = {
  light:   "impactLight",
  medium:  "impactMedium",
  heavy:   "impactHeavy",
  success: "notificationSuccess",
  warning: "notificationWarning",
  error:   "notificationError",
};

// Map to Web Vibration API durations (ms)
const VIBRATION: Record<HapticStyle, number | number[]> = {
  light:   30,
  medium:  50,
  heavy:   80,
  success: [30, 40, 30],
  warning: [50, 30, 50],
  error:   [80, 40, 80],
};

export function haptic(style: HapticStyle = "light"): void {
  if (typeof window === "undefined") return;
  const win = window as any;
  const medianStyle = MEDIAN_STYLE[style];

  // Median bridge — available on all Median plans
  // API: median.haptics.vibrate({ style: "impactLight" })
  if (typeof win.median?.haptics?.vibrate === "function") {
    win.median.haptics.vibrate({ style: medianStyle });
    return;
  }
  if (typeof win.gonative?.haptics?.vibrate === "function") {
    win.gonative.haptics.vibrate({ style: medianStyle });
    return;
  }
  // Some Median versions use .impact instead of .vibrate
  if (typeof win.median?.haptics?.impact === "function") {
    win.median.haptics.impact({ style: medianStyle });
    return;
  }
  if (typeof win.gonative?.haptics?.impact === "function") {
    win.gonative.haptics.impact({ style: medianStyle });
    return;
  }

  // Web Vibration API fallback (Android Chrome browser)
  if ("vibrate" in navigator) {
    navigator.vibrate(VIBRATION[style]);
  }
}
