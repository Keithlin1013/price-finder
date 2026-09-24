import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One variable family for labels, body and the sign numerals: the width axis gives the condensed
// warehouse-sign figures without a second face. Chinese falls back to the system CJK sans.
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "比价 Price Finder",
  description: "Compare Walmart, Target, Amazon and Costco prices for one product, per unit.",
};

export const viewport: Viewport = {
  themeColor: "#e8641b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
