import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IWOF Faturamento",
  description: "Sistema de Faturamento Interno — IWOF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} antialiased`}>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}

function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <main className="main-content">{children}</main>
    </>
  );
}
