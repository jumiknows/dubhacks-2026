import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "EmberReady",
  description: "Community wildfire briefings from NASA satellite thermal observations.",
};

export const viewport = { themeColor: "#07090c" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#briefing-heading">Skip to briefing</a>
        {children}
      </body>
    </html>
  );
}
