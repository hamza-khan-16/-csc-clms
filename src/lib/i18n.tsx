import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "hi" | "mr";

const STORAGE_KEY = "app_lang";

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.apply_leave": "Apply Leave",
    "nav.my_leaves": "My Leaves",
    "nav.schedule": "My Schedule",
    "nav.requests": "Leave Requests",
    "nav.proxies": "Proxy Duties",
    "nav.payroll": "Payroll",
    "nav.reports": "Reports",
    "nav.notices": "Notices",
    "nav.teachers": "Teachers",
    "nav.holidays": "Holidays",
    "nav.hr_panel": "HR Panel",
    "nav.admin_panel": "Admin Panel",
    "nav.profile": "Profile",
    "nav.logout": "Logout",
    // Dashboard
    "dash.welcome": "Welcome back",
    "dash.quick_actions": "Quick Actions",
    "dash.upcoming_holidays": "Upcoming Holidays",
    // Leave
    "leave.apply": "Apply Leave",
    "leave.casual": "Casual Leave",
    "leave.medical": "Medical Leave",
    "leave.duty": "Duty Leave",
    "leave.maternity": "Maternity Leave",
    "leave.bereavement": "Bereavement Leave",
    "leave.pending": "Pending",
    "leave.approved": "Approved",
    "leave.rejected": "Rejected",
    // Actions
    "action.approve": "Approve",
    "action.reject": "Reject",
    "action.withdraw": "Withdraw",
    "action.submit": "Submit",
    "action.cancel": "Cancel",
    "action.save": "Save",
    "action.close": "Close",
    "action.download": "Download",
    // Proxy
    "proxy.accept": "Accept",
    "proxy.decline": "Decline",
    "proxy.assign": "Assign Proxy",
    // Common
    "common.days": "days",
    "common.loading": "Loading…",
    "common.no_data": "No data",
    "common.search": "Search",
    "common.filter": "Filter",
    "common.from": "From",
    "common.to": "To",
    "common.department": "Department",
    "common.teacher": "Teacher",
    "common.date": "Date",
    "common.status": "Status",
    "common.reason": "Reason",
    "common.note": "Note",
    "common.salary": "Salary",
    "common.net_pay": "Net Pay",
    "common.deduction": "Deduction",
  },
  hi: {
    // Navigation
    "nav.dashboard": "डैशबोर्ड",
    "nav.apply_leave": "छुट्टी आवेदन",
    "nav.my_leaves": "मेरी छुट्टियाँ",
    "nav.schedule": "मेरा कार्यक्रम",
    "nav.requests": "छुट्टी अनुरोध",
    "nav.proxies": "प्रॉक्सी ड्यूटी",
    "nav.payroll": "वेतन",
    "nav.reports": "रिपोर्ट",
    "nav.notices": "नोटिस",
    "nav.teachers": "शिक्षक",
    "nav.holidays": "छुट्टियाँ",
    "nav.hr_panel": "HR पैनल",
    "nav.admin_panel": "एडमिन पैनल",
    "nav.profile": "प्रोफ़ाइल",
    "nav.logout": "लॉग आउट",
    // Dashboard
    "dash.welcome": "वापसी पर स्वागत है",
    "dash.quick_actions": "त्वरित क्रियाएँ",
    "dash.upcoming_holidays": "आगामी छुट्टियाँ",
    // Leave
    "leave.apply": "छुट्टी आवेदन करें",
    "leave.casual": "कैजुअल छुट्टी",
    "leave.medical": "चिकित्सा छुट्टी",
    "leave.duty": "ड्यूटी छुट्टी",
    "leave.maternity": "मातृत्व छुट्टी",
    "leave.bereavement": "शोक छुट्टी",
    "leave.pending": "लंबित",
    "leave.approved": "स्वीकृत",
    "leave.rejected": "अस्वीकृत",
    // Actions
    "action.approve": "स्वीकृत करें",
    "action.reject": "अस्वीकृत करें",
    "action.withdraw": "वापस लें",
    "action.submit": "जमा करें",
    "action.cancel": "रद्द करें",
    "action.save": "सहेजें",
    "action.close": "बंद करें",
    "action.download": "डाउनलोड",
    // Proxy
    "proxy.accept": "स्वीकार करें",
    "proxy.decline": "अस्वीकार करें",
    "proxy.assign": "प्रॉक्सी नियुक्त करें",
    // Common
    "common.days": "दिन",
    "common.loading": "लोड हो रहा है…",
    "common.no_data": "कोई डेटा नहीं",
    "common.search": "खोजें",
    "common.filter": "फ़िल्टर",
    "common.from": "से",
    "common.to": "तक",
    "common.department": "विभाग",
    "common.teacher": "शिक्षक",
    "common.date": "तारीख",
    "common.status": "स्थिति",
    "common.reason": "कारण",
    "common.note": "नोट",
    "common.salary": "वेतन",
    "common.net_pay": "शुद्ध वेतन",
    "common.deduction": "कटौती",
  },
  mr: {
    // Navigation
    "nav.dashboard": "डॅशबोर्ड",
    "nav.apply_leave": "रजा अर्ज",
    "nav.my_leaves": "माझ्या रजा",
    "nav.schedule": "माझे वेळापत्रक",
    "nav.requests": "रजा विनंत्या",
    "nav.proxies": "प्रॉक्सी ड्युटी",
    "nav.payroll": "पगार",
    "nav.reports": "अहवाल",
    "nav.notices": "सूचना",
    "nav.teachers": "शिक्षक",
    "nav.holidays": "सुट्ट्या",
    "nav.hr_panel": "HR पॅनल",
    "nav.admin_panel": "अॅडमिन पॅनल",
    "nav.profile": "प्रोफाइल",
    "nav.logout": "लॉग आउट",
    // Dashboard
    "dash.welcome": "परत स्वागत आहे",
    "dash.quick_actions": "द्रुत क्रिया",
    "dash.upcoming_holidays": "आगामी सुट्ट्या",
    // Leave
    "leave.apply": "रजा अर्ज करा",
    "leave.casual": "कॅज्युअल रजा",
    "leave.medical": "वैद्यकीय रजा",
    "leave.duty": "ड्युटी रजा",
    "leave.maternity": "मातृत्व रजा",
    "leave.bereavement": "शोक रजा",
    "leave.pending": "प्रलंबित",
    "leave.approved": "मंजूर",
    "leave.rejected": "नाकारले",
    // Actions
    "action.approve": "मंजूर करा",
    "action.reject": "नाकारा",
    "action.withdraw": "मागे घ्या",
    "action.submit": "सादर करा",
    "action.cancel": "रद्द करा",
    "action.save": "जतन करा",
    "action.close": "बंद करा",
    "action.download": "डाउनलोड",
    // Proxy
    "proxy.accept": "स्वीकारा",
    "proxy.decline": "नाकारा",
    "proxy.assign": "प्रॉक्सी नियुक्त करा",
    // Common
    "common.days": "दिवस",
    "common.loading": "लोड होत आहे…",
    "common.no_data": "डेटा नाही",
    "common.search": "शोधा",
    "common.filter": "फिल्टर",
    "common.from": "पासून",
    "common.to": "पर्यंत",
    "common.department": "विभाग",
    "common.teacher": "शिक्षक",
    "common.date": "तारीख",
    "common.status": "स्थिती",
    "common.reason": "कारण",
    "common.note": "नोंद",
    "common.salary": "पगार",
    "common.net_pay": "निव्वळ वेतन",
    "common.deduction": "कपात",
  },
};

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    return (localStorage.getItem(STORAGE_KEY) as Lang | null) ?? "en";
  });

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  }

  function t(key: string): string {
    return TRANSLATIONS[lang][key] ?? TRANSLATIONS.en[key] ?? key;
  }

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}

export const LANG_LABELS: Record<Lang, string> = {
  en: "EN",
  hi: "हि",
  mr: "म",
};

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
};
