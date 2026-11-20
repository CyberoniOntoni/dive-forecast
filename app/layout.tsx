import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { AccountLink } from "@/components/AccountLink";
import { AppTabs } from "@/components/AppTabs";
import { BetaInvite } from "@/components/BetaInvite";
import { BrandMark } from "@/components/BrandMark";
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
  title: "50Bar · Maldives dive currents",
  description: "Maldives dive-site current forecast: which way and how strong, hour by hour for a week, from the tide, the monsoon current and divers' reports.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <header className="chart-bar chart-bar-top flex print:hidden items-center justify-between gap-3">
          <MapPageLink
            href="/"
            className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl pr-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            <BrandMark />
            {/* Below 420 px the three tabs and the account button need the room: the mark alone stands for the name. */}
            <span className="min-w-0 max-[419px]:sr-only">
              <span className="chart-name block">50Bar</span>
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
        <Suspense fallback={null}>
          <BetaInvite />
        </Suspense>
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
