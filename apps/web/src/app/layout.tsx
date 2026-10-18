import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "../components/esper/esper.css";
import { AppGestures } from "../components/esper/gestures";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "OrbiCart",
  description: "Shop for where life takes you: camping kits grounded in NASA Earth data.",
};

export const viewport = { themeColor: "#07090c" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main-content">Skip to main content</a>
        <AppGestures>{children}</AppGestures>
      </body>
    </html>
  );
}
