import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Afterlight — Orbital Power-Grid & Dynamic Equipment NFT Survival Game on NEAR",
  description:
    "Turn-based orbital station power-grid and NEP-171 dynamic equipment survival economy game on NEAR Protocol.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
