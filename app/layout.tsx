import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { AppTabs } from "@/components/AppTabs";
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
          <div className="min-w-0">
            <p className="chart-name">Dive current</p>
            {/* On a phone the map and the forecast need the height more than the tagline. */}
            <p className="chart-line hidden sm:block">Maldives dive sites, incoming or outgoing right now.</p>
          </div>
          <Suspense fallback={null}>
            <AppTabs />
          </Suspense>
        </header>
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
