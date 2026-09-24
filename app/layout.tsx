import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Attribution } from "@/components/Attribution";
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
  description: "Per-site Maldives current forecast from the tide slope and dive reports.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <header className="chart-bar chart-bar-top">
          <p className="chart-name">Dive current</p>
          <p className="chart-line">Maldives dive sites, incoming or outgoing right now.</p>
        </header>
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
        <Attribution />
      </body>
    </html>
  );
}
