"use client";

import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { usePathname } from "next/navigation";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased font-sans">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}

function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  return (
    <>
      <Sidebar />
      <main className={`main-content ${isLoginPage ? "no-sidebar" : ""}`}>
        {children}
      </main>
    </>
  );
}
