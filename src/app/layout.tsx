import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nut Analytics",
  description: "Self-hosted web analytics with conversion and revenue tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
