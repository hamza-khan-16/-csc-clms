import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";

// JSON-LD structured data — tells Google about the site and enables sitelinks
// in search results (the 2–3 link buttons shown below the main result).
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "name": "CSC Leave Management System",
      "alternateName": "CSC LMS",
      "description": "Official leave management portal for Chandrabhan Sharma College. Teachers apply for leave, track approvals, and view proxy assignments. HODs and the Principal manage and approve requests online.",
      "url": "https://csc-clms2.vercel.app",
      // SiteLinksSearchBox — enables the search box in Google results (optional)
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://csc-clms2.vercel.app/leaves?filter={search_term_string}"
        },
        "query-input": "required name=search_term_string"
      }
    },
    {
      // Sitelinks — Google picks these up automatically but this helps signal priority
      "@type": "ItemList",
      "name": "Quick Links",
      "itemListElement": [
        {
          "@type": "SiteLinksSearchBox",
          "@id": "https://csc-clms2.vercel.app/#sitelinks"
        },
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Login",
          "description": "Sign in to the leave management portal",
          "url": "https://csc-clms2.vercel.app/login"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Apply for Leave",
          "description": "Submit a new leave application",
          "url": "https://csc-clms2.vercel.app/apply"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "My Leaves",
          "description": "Track your leave history and approval status",
          "url": "https://csc-clms2.vercel.app/leaves"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Leave Requests",
          "description": "Review and approve pending leave requests (HOD / Principal)",
          "url": "https://csc-clms2.vercel.app/requests"
        }
      ]
    },
    {
      "@type": "Organization",
      "name": "Chandrabhan Sharma College",
      "alternateName": "CSC",
      "url": "https://csc-clms2.vercel.app"
    }
  ]
};

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      // Lock to portrait — the app layout is portrait-only, landscape breaks bottom nav
      { name: "screen-orientation", content: "portrait" },
      { title: "CSC Leave Management System" },
      {
        name: "description",
        content:
          "Official leave management portal for Chandrabhan Sharma College. Teachers can apply for leave, track approvals, view proxy assignments and payroll deductions. HODs and the Principal manage and approve requests online.",
      },
      // Open Graph — controls previews in WhatsApp, Teams, social media
      { property: "og:type",        content: "website" },
      { property: "og:title",       content: "CSC Leave Management System" },
      { property: "og:description", content: "Apply for leave, track approvals, and manage proxy assignments — Chandrabhan Sharma College's official leave portal for teachers, HODs and the Principal." },
      { property: "og:site_name",   content: "CSC Leave Management" },
      { property: "og:url",         content: "https://csc-clms2.vercel.app" },
      // Twitter / X
      { name: "twitter:card",        content: "summary" },
      { name: "twitter:title",       content: "CSC Leave Management System" },
      { name: "twitter:description", content: "Official leave portal for Chandrabhan Sharma College — apply, track, and approve leaves online." },
      // Public pages (login) are indexable; authenticated routes override with noindex
      { name: "robots", content: "index, follow" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Blocking script — applies dark class before paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();` }} />
        {/* Lock orientation to portrait — prevents layout breaking on phone rotation */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(screen.orientation&&screen.orientation.lock){screen.orientation.lock('portrait').catch(function(){});}}catch(e){}})();` }} />
        {/* JSON-LD structured data — enables Google sitelinks (the 2–3 link buttons below the search result) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />  
        <meta name="google-site-verification" content="Gappp0r5rWLgFoGflSVQiC2TQ0LFrjSutMFGJtimN-M" />

      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
