import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { AccountLink } from "@/components/AccountLink";
import { AppTabs } from "@/components/AppTabs";
import { MapPageLink } from "@/components/MapPageLink";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dive current",
  description: "Maldives dive-site current forecast: which way and how strong, hour by hour for a week, from the tide, the monsoon current and divers' reports.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <header className="chart-bar chart-bar-top flex items-center justify-between gap-3">
          <MapPageLink
            href="/"
            className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl pr-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            <BrandMark />
            <span className="min-w-0">
              <span className="chart-name block">Dive current</span>
              {/* On a phone the map and the forecast need the height more than the tagline. */}
              <span className="chart-line hidden sm:block">Maldives dive sites, incoming or outgoing right now.</span>
            </span>
          </MapPageLink>
          <div className="flex shrink-0 items-center gap-1">
            <Suspense fallback={null}>
              <AppTabs />
            </Suspense>
            <Suspense fallback={null}>
              <AccountLink />
            </Suspense>
          </div>
        </header>
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}

/** An arrow riding a wave: the app's mark, in the incoming teal. */
function BrandMark() {
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl bg-incoming/15 text-incoming ring-1 ring-incoming/30">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 15c2 0 2-2 4.5-2S10 15 12 15s2.5-2 4.5-2 2.5 2 4.5 2" />
        <path d="M6 9h11M14 6l3 3-3 3" />
      </svg>
    </span>
  );
}
