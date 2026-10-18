import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "EmberReady",
  description: "Community wildfire briefings from satellite observations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#briefing-heading">Skip to briefing</a>
        {children}
      </body>
    </html>
  );
}
