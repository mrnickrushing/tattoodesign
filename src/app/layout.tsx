import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import NavBar from "@/components/NavBar";
import "./globals.css";

const display = Bebas_Neue({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inkline — Tattoo Flash Toolkit",
  description:
    "Generate flash, convert photos into tattoo-ready stencils, and build printable flash sheets.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NavBar />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
