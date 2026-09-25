/**
 * i18n.tsx — language context
 *
 * Per-user storage: lang is keyed by userId so each user on the same device
 * has their own language preference (app_lang:<userId>).
 * Falls back to app_lang (legacy key) then "en".
 *
 * LangProvider   — place at root, outside AuthProvider
 * LangUserSync   — place inside AuthProvider; reads/writes per-user key
 * useLang()      — full context (lang, setLang, t)
 * useT()         — just the t() function; causes re-render on lang change
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "hi" | "mr";

/** @internal Legacy shared key — used only as fallback if no userId yet */
const LEGACY_KEY = "app_lang";

/** Per-user storage key */
function userKey(userId: string) {
  return `app_lang:${userId}`;
}

// ─── translations ─────────────────────────────────────────────────────────────
// TRANSLATIONS is module-level so t() lookups are O(1) with no allocations.

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    // Navigation
    "nav.dashboard":    "Dashboard",
    "nav.apply_leave":  "Apply Leave",
    "nav.my_leaves":    "My Leaves",
    "nav.schedule":     "My Schedule",
    "nav.requests":     "Leave Requests",
    "nav.proxies":      "Proxy Duties",
    "nav.payroll":      "Payroll",
    "nav.reports":      "Reports",
    "nav.notices":      "Notices",
    "nav.teachers":     "Teachers",
    "nav.holidays":     "Holidays",
    "nav.hr_panel":     "HR Panel",
    "nav.admin_panel":  "Admin Panel",
    "nav.departments":  "Departments",
    "nav.profile":      "Profile",
    "nav.logout":       "Logout",
    // Dashboard
    "dash.welcome":             "Welcome back",
    "dash.quick_actions":       "Quick Actions",
    "dash.upcoming_holidays":   "Upcoming Holidays",
    "dash.whos_absent":         "Who's Absent Today",
    "dash.all_present":         "All teachers present",
    "dash.leave_calendar":      "Department Leave Calendar",
    "dash.whos_absent_month":   "Who's absent each day this month",
    "dash.leave_summary":       "Leave summary",
    "dash.current_month":       "Current month",
    "dash.leave_trend":         "Leave Trend",
    "dash.today_schedule":      "Today's Schedule",
    "dash.proxy_assignments":   "Proxy Assignments (To Me)",
    "dash.attendance_overview": "Attendance Overview",
    // Leave
    "leave.apply":              "Apply Leave",
    "leave.casual":             "Casual Leave",
    "leave.medical":            "Medical Leave",
    "leave.duty":               "Duty Leave",
    "leave.maternity":          "Maternity Leave",
    "leave.bereavement":        "Bereavement Leave",
    "leave.emergency":          "Emergency Leave",
    "leave.pending":            "Pending",
    "leave.approved":           "Approved",
    "leave.rejected":           "Rejected",
    "leave.withdrawn":          "Withdrawn",
    "leave.balance":            "Leave Balance",
    "leave.type":               "Leave Type",
    "leave.from_date":          "From Date",
    "leave.to_date":            "To Date",
    "leave.duration":           "Duration",
    "leave.reason":             "Reason",
    "leave.contact":            "Contact During Leave",
    "leave.document":           "Supporting Document",
    // Actions
    "action.approve":  "Approve",
    "action.reject":   "Reject",
    "action.withdraw": "Withdraw",
    "action.submit":   "Submit",
    "action.cancel":   "Cancel",
    "action.save":     "Save",
    "action.close":    "Close",
    "action.download": "Download",
    "action.edit":     "Edit",
    "action.delete":   "Delete",
    "action.view":     "View",
    "action.export":   "Export",
    "action.search":   "Search",
    "action.filter":   "Filter",
    "action.back":     "Back",
    "action.next":     "Next",
    "action.upload":   "Upload",
    // Proxy
    "proxy.accept":         "Accept",
    "proxy.decline":        "Decline",
    "proxy.assign":         "Assign Proxy",
    "proxy.my_duties":      "My Proxy Duties",
    "proxy.assigned_to_me": "Assigned to Me",
    "proxy.i_assigned":     "I Assigned",
    // Payroll
    "payroll.slip":          "Salary Slip",
    "payroll.basic":         "Basic Salary",
    "payroll.net":           "Net Pay",
    "payroll.deductions":    "Deductions",
    "payroll.days_present":  "Days Present",
    "payroll.days_absent":   "Days Absent",
    "payroll.unpaid_leave":  "Unpaid Leave",
    "payroll.download_slip": "Download Slip",
    // Requests (HOD/Principal)
    "requests.pending":  "Pending Requests",
    "requests.history":  "Request History",
    "requests.all":      "All Requests",
    "requests.approve_note":  "Approval note (optional)",
    "requests.reject_reason": "Rejection reason",
    // Schedule
    "schedule.weekly":   "Weekly Schedule",
    "schedule.no_class": "No classes scheduled",
    "schedule.free":     "Free period",
    // Common
    "common.days":        "days",
    "common.loading":     "Loading…",
    "common.no_data":     "No data",
    "common.search":      "Search",
    "common.filter":      "Filter",
    "common.from":        "From",
    "common.to":          "To",
    "common.department":  "Department",
    "common.teacher":     "Teacher",
    "common.date":        "Date",
    "common.status":      "Status",
    "common.reason":      "Reason",
    "common.note":        "Note",
    "common.salary":      "Salary",
    "common.net_pay":     "Net Pay",
    "common.deduction":   "Deduction",
    "common.month":       "Month",
    "common.year":        "Year",
    "common.all":         "All",
    "common.none":        "None",
    "common.yes":         "Yes",
    "common.no":          "No",
    "common.error":       "Something went wrong",
    "common.retry":       "Retry",
    "common.name":        "Name",
    "common.role":        "Role",
    "common.phone":       "Phone",
    "common.email":       "Email",
    "common.present":     "Present",
    "common.absent":      "Absent",
    "common.holiday":     "Holiday",
    "common.sunday":      "Sunday",
  },

  hi: {
    "nav.dashboard":    "डैशबोर्ड",
    "nav.apply_leave":  "छुट्टी आवेदन",
    "nav.my_leaves":    "मेरी छुट्टियाँ",
    "nav.schedule":     "मेरा कार्यक्रम",
    "nav.requests":     "छुट्टी अनुरोध",
    "nav.proxies":      "प्रॉक्सी ड्यूटी",
    "nav.payroll":      "वेतन",
    "nav.reports":      "रिपोर्ट",
    "nav.notices":      "नोटिस",
    "nav.teachers":     "शिक्षक",
    "nav.holidays":     "छुट्टियाँ",
    "nav.hr_panel":     "HR पैनल",
    "nav.admin_panel":  "एडमिन पैनल",
    "nav.departments":  "विभाग",
    "nav.profile":      "प्रोफ़ाइल",
    "nav.logout":       "लॉग आउट",
    "dash.welcome":             "वापसी पर स्वागत है",
    "dash.quick_actions":       "त्वरित क्रियाएँ",
    "dash.upcoming_holidays":   "आगामी छुट्टियाँ",
    "dash.whos_absent":         "आज कौन अनुपस्थित है",
    "dash.all_present":         "सभी शिक्षक उपस्थित",
    "dash.leave_calendar":      "विभाग छुट्टी कैलेंडर",
    "dash.whos_absent_month":   "इस महीने प्रत्येक दिन कौन अनुपस्थित है",
    "dash.leave_summary":       "छुट्टी सारांश",
    "dash.current_month":       "वर्तमान माह",
    "dash.leave_trend":         "छुट्टी प्रवृत्ति",
    "dash.today_schedule":      "आज का कार्यक्रम",
    "dash.proxy_assignments":   "प्रॉक्सी असाइनमेंट (मुझे)",
    "dash.attendance_overview": "उपस्थिति अवलोकन",
    "leave.apply":        "छुट्टी आवेदन करें",
    "leave.casual":       "कैजुअल छुट्टी",
    "leave.medical":      "चिकित्सा छुट्टी",
    "leave.duty":         "ड्यूटी छुट्टी",
    "leave.maternity":    "मातृत्व छुट्टी",
    "leave.bereavement":  "शोक छुट्टी",
    "leave.emergency":    "आपातकालीन छुट्टी",
    "leave.pending":      "लंबित",
    "leave.approved":     "स्वीकृत",
    "leave.rejected":     "अस्वीकृत",
    "leave.withdrawn":    "वापस लिया",
    "leave.balance":      "छुट्टी शेष",
    "leave.type":         "छुट्टी प्रकार",
    "leave.from_date":    "प्रारंभ तिथि",
    "leave.to_date":      "समाप्ति तिथि",
    "leave.duration":     "अवधि",
    "leave.reason":       "कारण",
    "leave.contact":      "छुट्टी के दौरान संपर्क",
    "leave.document":     "सहायक दस्तावेज़",
    "action.approve":  "स्वीकृत करें",
    "action.reject":   "अस्वीकृत करें",
    "action.withdraw": "वापस लें",
    "action.submit":   "जमा करें",
    "action.cancel":   "रद्द करें",
    "action.save":     "सहेजें",
    "action.close":    "बंद करें",
    "action.download": "डाउनलोड",
    "action.edit":     "संपादित करें",
    "action.delete":   "हटाएँ",
    "action.view":     "देखें",
    "action.export":   "निर्यात",
    "action.search":   "खोजें",
    "action.filter":   "फ़िल्टर",
    "action.back":     "वापस",
    "action.next":     "अगला",
    "action.upload":   "अपलोड",
    "proxy.accept":         "स्वीकार करें",
    "proxy.decline":        "अस्वीकार करें",
    "proxy.assign":         "प्रॉक्सी नियुक्त करें",
    "proxy.my_duties":      "मेरी प्रॉक्सी ड्यूटी",
    "proxy.assigned_to_me": "मुझे असाइन की गई",
    "proxy.i_assigned":     "मैंने असाइन की",
    "payroll.slip":          "वेतन पर्ची",
    "payroll.basic":         "मूल वेतन",
    "payroll.net":           "शुद्ध वेतन",
    "payroll.deductions":    "कटौतियाँ",
    "payroll.days_present":  "उपस्थित दिन",
    "payroll.days_absent":   "अनुपस्थित दिन",
    "payroll.unpaid_leave":  "अवैतनिक छुट्टी",
    "payroll.download_slip": "वेतन पर्ची डाउनलोड करें",
    "requests.pending":       "लंबित अनुरोध",
    "requests.history":       "अनुरोध इतिहास",
    "requests.all":           "सभी अनुरोध",
    "requests.approve_note":  "अनुमोदन नोट (वैकल्पिक)",
    "requests.reject_reason": "अस्वीकृति कारण",
    "schedule.weekly":   "साप्ताहिक कार्यक्रम",
    "schedule.no_class": "कोई कक्षा निर्धारित नहीं",
    "schedule.free":     "मुक्त अवधि",
    "common.days":       "दिन",
    "common.loading":    "लोड हो रहा है…",
    "common.no_data":    "कोई डेटा नहीं",
    "common.search":     "खोजें",
    "common.filter":     "फ़िल्टर",
    "common.from":       "से",
    "common.to":         "तक",
    "common.department": "विभाग",
    "common.teacher":    "शिक्षक",
    "common.date":       "तारीख",
    "common.status":     "स्थिति",
    "common.reason":     "कारण",
    "common.note":       "नोट",
    "common.salary":     "वेतन",
    "common.net_pay":    "शुद्ध वेतन",
    "common.deduction":  "कटौती",
    "common.month":      "माह",
    "common.year":       "वर्ष",
    "common.all":        "सभी",
    "common.none":       "कोई नहीं",
    "common.yes":        "हाँ",
    "common.no":         "नहीं",
    "common.error":      "कुछ गलत हो गया",
    "common.retry":      "पुन: प्रयास करें",
    "common.name":       "नाम",
    "common.role":       "भूमिका",
    "common.phone":      "फ़ोन",
    "common.email":      "ईमेल",
    "common.present":    "उपस्थित",
    "common.absent":     "अनुपस्थित",
    "common.holiday":    "छुट्टी",
    "common.sunday":     "रविवार",
  },

  mr: {
    "nav.dashboard":    "डॅशबोर्ड",
    "nav.apply_leave":  "रजा अर्ज",
    "nav.my_leaves":    "माझ्या रजा",
    "nav.schedule":     "माझे वेळापत्रक",
    "nav.requests":     "रजा विनंत्या",
    "nav.proxies":      "प्रॉक्सी ड्युटी",
    "nav.payroll":      "पगार",
    "nav.reports":      "अहवाल",
    "nav.notices":      "सूचना",
    "nav.teachers":     "शिक्षक",
    "nav.holidays":     "सुट्ट्या",
    "nav.hr_panel":     "HR पॅनल",
    "nav.admin_panel":  "अॅडमिन पॅनल",
    "nav.departments":  "विभाग",
    "nav.profile":      "प्रोफाइल",
    "nav.logout":       "लॉग आउट",
    "dash.welcome":             "परत स्वागत आहे",
    "dash.quick_actions":       "द्रुत क्रिया",
    "dash.upcoming_holidays":   "आगामी सुट्ट्या",
    "dash.whos_absent":         "आज कोण अनुपस्थित आहे",
    "dash.all_present":         "सर्व शिक्षक उपस्थित",
    "dash.leave_calendar":      "विभाग रजा दिनदर्शिका",
    "dash.whos_absent_month":   "या महिन्यात दररोज कोण अनुपस्थित आहे",
    "dash.leave_summary":       "रजा सारांश",
    "dash.current_month":       "चालू महिना",
    "dash.leave_trend":         "रजा प्रवृत्ती",
    "dash.today_schedule":      "आजचे वेळापत्रक",
    "dash.proxy_assignments":   "प्रॉक्सी नियुक्त्या (मला)",
    "dash.attendance_overview": "उपस्थिती आढावा",
    "leave.apply":        "रजा अर्ज करा",
    "leave.casual":       "कॅज्युअल रजा",
    "leave.medical":      "वैद्यकीय रजा",
    "leave.duty":         "ड्युटी रजा",
    "leave.maternity":    "मातृत्व रजा",
    "leave.bereavement":  "शोक रजा",
    "leave.emergency":    "आपत्कालीन रजा",
    "leave.pending":      "प्रलंबित",
    "leave.approved":     "मंजूर",
    "leave.rejected":     "नाकारले",
    "leave.withdrawn":    "मागे घेतले",
    "leave.balance":      "रजा शिल्लक",
    "leave.type":         "रजा प्रकार",
    "leave.from_date":    "प्रारंभ तारीख",
    "leave.to_date":      "समाप्ती तारीख",
    "leave.duration":     "कालावधी",
    "leave.reason":       "कारण",
    "leave.contact":      "रजेदरम्यान संपर्क",
    "leave.document":     "सहाय्यक दस्तावेज",
    "action.approve":  "मंजूर करा",
    "action.reject":   "नाकारा",
    "action.withdraw": "मागे घ्या",
    "action.submit":   "सादर करा",
    "action.cancel":   "रद्द करा",
    "action.save":     "जतन करा",
    "action.close":    "बंद करा",
    "action.download": "डाउनलोड",
    "action.edit":     "संपादित करा",
    "action.delete":   "हटवा",
    "action.view":     "पहा",
    "action.export":   "निर्यात करा",
    "action.search":   "शोधा",
    "action.filter":   "फिल्टर",
    "action.back":     "मागे",
    "action.next":     "पुढे",
    "action.upload":   "अपलोड करा",
    "proxy.accept":         "स्वीकारा",
    "proxy.decline":        "नाकारा",
    "proxy.assign":         "प्रॉक्सी नियुक्त करा",
    "proxy.my_duties":      "माझ्या प्रॉक्सी ड्युट्या",
    "proxy.assigned_to_me": "मला नियुक्त केलेल्या",
    "proxy.i_assigned":     "मी नियुक्त केलेल्या",
    "payroll.slip":          "पगार पर्ची",
    "payroll.basic":         "मूळ पगार",
    "payroll.net":           "निव्वळ वेतन",
    "payroll.deductions":    "वजावट",
    "payroll.days_present":  "उपस्थित दिवस",
    "payroll.days_absent":   "अनुपस्थित दिवस",
    "payroll.unpaid_leave":  "अवैतनिक रजा",
    "payroll.download_slip": "पगार पर्ची डाउनलोड करा",
    "requests.pending":       "प्रलंबित विनंत्या",
    "requests.history":       "विनंती इतिहास",
    "requests.all":           "सर्व विनंत्या",
    "requests.approve_note":  "मंजुरी नोंद (पर्यायी)",
    "requests.reject_reason": "नकार कारण",
    "schedule.weekly":   "साप्ताहिक वेळापत्रक",
    "schedule.no_class": "कोणताही वर्ग निर्धारित नाही",
    "schedule.free":     "मोकळा तास",
    "common.days":       "दिवस",
    "common.loading":    "लोड होत आहे…",
    "common.no_data":    "डेटा नाही",
    "common.search":     "शोधा",
    "common.filter":     "फिल्टर",
    "common.from":       "पासून",
    "common.to":         "पर्यंत",
    "common.department": "विभाग",
    "common.teacher":    "शिक्षक",
    "common.date":       "तारीख",
    "common.status":     "स्थिती",
    "common.reason":     "कारण",
    "common.note":       "नोंद",
    "common.salary":     "पगार",
    "common.net_pay":    "निव्वळ वेतन",
    "common.deduction":  "कपात",
    "common.month":      "महिना",
    "common.year":       "वर्ष",
    "common.all":        "सर्व",
    "common.none":       "काहीही नाही",
    "common.yes":        "होय",
    "common.no":         "नाही",
    "common.error":      "काहीतरी चुकले",
    "common.retry":      "पुन्हा प्रयत्न करा",
    "common.name":       "नाव",
    "common.role":       "भूमिका",
    "common.phone":      "फोन",
    "common.email":      "ईमेल",
    "common.present":    "उपस्थित",
    "common.absent":     "अनुपस्थित",
    "common.holiday":    "सुट्टी",
    "common.sunday":     "रविवार",
  },
};

// ─── context ──────────────────────────────────────────────────────────────────

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  /** internal — called by LangUserSync once userId is known */
  _setUserId: (id: string | null) => void;
}

const LangContext = createContext<LangCtx | null>(null);

// ─── provider ─────────────────────────────────────────────────────────────────

// ─── Google Translate integration ─────────────────────────────────────────────
const GT_LANG: Record<Lang, string> = { en: "en", hi: "hi", mr: "mr" };

function injectGoogleTranslate() {
  if (typeof window === "undefined") return;
  if ((window as any).__gtInjected) return;
  (window as any).__gtInjected = true;

  const style = document.createElement("style");
  style.id = "gt-hide-style";
  style.textContent = `
    #gt-anchor, #gt-anchor *,
    .skiptranslate, .skiptranslate *,
    .goog-te-banner-frame, .goog-te-menu-frame,
    .goog-te-balloon-frame, .goog-tooltip, .goog-tooltip *,
    .goog-te-gadget, .goog-te-gadget *,
    .VIpgJd-ZVi9od-aZ2wEe-wOHMyf,
    iframe[name="votingFrame"] { display: none !important; }
    body { top: 0 !important; }
  `;
  document.head.appendChild(style);

  const anchor = document.createElement("div");
  anchor.id = "gt-anchor";
  // Position off-screen but NOT display:none — GT won't populate the select if hidden at init
  anchor.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
  document.body.appendChild(anchor);

  (window as any).googleTranslateElementInit = function () {
    new (window as any).google.translate.TranslateElement(
      {
        pageLanguage: "en",
        includedLanguages: "en,hi,mr",
        autoDisplay: false,
        gaTrack: false,
      },
      "gt-anchor"
    );
  };

  const script = document.createElement("script");
  script.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  document.head.appendChild(script);
}

function applyGoogleTranslate(lang: Lang) {
  if (typeof window === "undefined") return;
  const code = GT_LANG[lang];

  // Set the googtrans cookie first — GT reads this as the authoritative
  // language source and uses it even if the select event is missed.
  const cookieVal = lang === "en" ? "" : `/en/${code}`;
  document.cookie = `googtrans=${cookieVal}; path=/`;
  document.cookie = `googtrans=${cookieVal}; path=/; domain=${window.location.hostname}`;

  function fireSelect(select: HTMLSelectElement, value: string) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input",  { bubbles: true }));
  }

  function attempt(tries: number) {
    const select = document.querySelector<HTMLSelectElement>(".goog-te-combo");
    if (!select) {
      if (tries > 0) setTimeout(() => attempt(tries - 1), 400);
      return;
    }

    if (lang === "en") {
      document.cookie = "googtrans=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = `googtrans=; path=/; domain=${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      fireSelect(select, "en");
      return;
    }

    const currentVal = select.value;
    // Switching directly between two non-English languages is unreliable in GT.
    // Always bounce through English first, then apply the target language.
    if (currentVal && currentVal !== "en" && currentVal !== code) {
      fireSelect(select, "en");
      setTimeout(() => {
        const s2 = document.querySelector<HTMLSelectElement>(".goog-te-combo");
        if (s2) fireSelect(s2, code);
      }, 800);
      return;
    }

    fireSelect(select, code);
  }

  // Double rAF ensures React finishes painting before GT touches text nodes
  requestAnimationFrame(() => requestAnimationFrame(() => attempt(20)));
}

export function LangProvider({ children }: { children: ReactNode }) {
  // userId is unknown until AuthProvider resolves — LangUserSync calls _setUserId.
  // We never read from the shared LEGACY_KEY on mount to avoid one user's
  // language preference bleeding into another user's session.
  const userIdRef = useRef<string | null>(null);

  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    // On mount we don't have a userId yet, so we can't read the per-user key.
    // Default to English; _setUserId will restore the correct language once
    // auth resolves (before the user sees any content).
    return "en";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    // Always save to the per-user key when we have a userId.
    // Fall back to LEGACY_KEY only when called before auth (e.g. login page).
    try {
      if (userIdRef.current) {
        localStorage.setItem(userKey(userIdRef.current), l);
      } else {
        localStorage.setItem(LEGACY_KEY, l);
      }
    } catch { /**/ }

    // Set the googtrans cookie and reload for ALL language changes so GT is
    // applied cleanly from the cookie on the fresh page load.
    // English clears the cookie; non-English sets /en/<code>.
    applyGoogleTranslate(l);
    setTimeout(() => window.location.reload(), 50);
  }, []);

  // Called by LangUserSync with the authed user's id (or null on logout).
  const _setUserId = useCallback((id: string | null) => {
    userIdRef.current = id;
    if (!id) {
      // Logged out — reset to English so the next user starts clean.
      setLangState("en");
      document.documentElement.lang = "en";
      // Clear the GT cookie so the page shows English.
      document.cookie = "googtrans=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = `googtrans=; path=/; domain=${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      return;
    }
    try {
      // Read only the per-user key — never LEGACY_KEY, to avoid inheriting
      // a previous user's preference on a shared device.
      const saved = (localStorage.getItem(userKey(id)) as Lang | null) ?? "en";
      setLangState(saved);
      document.documentElement.lang = saved;

      if (saved !== "en") {
        // Check if the GT cookie is already set to the right language.
        // If not (e.g. fresh login after logout, or new device), apply it
        // and reload so GT translates the page from the cookie on load.
        const currentCookie = document.cookie
          .split(";")
          .map(c => c.trim())
          .find(c => c.startsWith("googtrans="))
          ?.split("=")[1] ?? "";
        const expectedCookie = `/en/${GT_LANG[saved as Lang]}`;
        if (currentCookie !== expectedCookie) {
          applyGoogleTranslate(saved as Lang);
          setTimeout(() => window.location.reload(), 50);
        }
      }
    } catch { /**/ }
  }, []);

  // t() — new reference only when lang changes (O(1) lookup)
  const t = useCallback(
    (key: string): string =>
      TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key,
    [lang],
  );

  const value = useMemo(
    () => ({ lang, setLang, t, _setUserId }),
    [lang, setLang, t, _setUserId],
  );

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // Inject Google Translate once on mount.
  // NOTE: do NOT call applyGoogleTranslate here — lang is captured at mount
  // time and _setUserId (which runs after auth) may change it. GT is applied
  // inside _setUserId after the correct lang is known.
  useEffect(() => {
    injectGoogleTranslate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LangContext.Provider value={value}>
      {children}
    </LangContext.Provider>
  );
}

// ─── LangUserSync — mount this inside AuthProvider ────────────────────────────

/**
 * Tiny bridge component. Place it inside AuthProvider (but still inside
 * LangProvider) so it can read the authed userId and tell LangProvider
 * which per-user storage key to use.
 *
 * Usage in __root.tsx:
 *   <LangProvider>
 *     <AuthProvider>
 *       <LangUserSync />
 *       <Outlet />
 *     </AuthProvider>
 *   </LangProvider>
 */
export function LangUserSync({ userId }: { userId: string | null }) {
  const ctx = useContext(LangContext);
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (!ctx || userId === prevId.current) return;
    prevId.current = userId;
    ctx._setUserId(userId);
  }, [ctx, userId]);

  return null;
}

// ─── hooks ────────────────────────────────────────────────────────────────────

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}

/**
 * useT — only the t() function.
 * Re-renders the caller only when the language changes.
 * Zero cost when language is stable.
 */
export function useT(): (key: string) => string {
  return useLang().t;
}

// ─── constants ────────────────────────────────────────────────────────────────

export const LANG_LABELS: Record<Lang, string> = { en: "EN", hi: "हि", mr: "म" };
export const LANG_NAMES:  Record<Lang, string> = { en: "English", hi: "हिन्दी", mr: "मराठी" };
