"use client";

import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { usePathname } from "next/navigation";

import { ThemeProvider } from "@/components/ThemeProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased font-sans">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <LayoutShell>{children}</LayoutShell>
        </ThemeProvider>
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
