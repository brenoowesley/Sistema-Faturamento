"use client";

import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
  const router = useRouter();
  const supabase = createClient();
  const [isVerifyingRoute, setIsVerifyingRoute] = useState(true);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    async function verifyRoute() {
      if (isLoginPage) {
        setIsVerifyingRoute(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("usuarios_perfis")
          .select("cargo")
          .eq("id", user.id)
          .single();

        const cargo = data?.cargo || "USER";

        if (cargo === "CX") {
          // Bloquear acesso a abas do sistema que não sejam as permitidas
          const rotasPermitidasCX = ["/saques/acompanhamento", "/perfil"];
          const isAllowed = rotasPermitidasCX.some(route => pathname.startsWith(route));
          
          if (!isAllowed) {
            router.push("/saques/acompanhamento");
            return;
          }
        }
      }
      setIsVerifyingRoute(false);
    }
    verifyRoute();
  }, [pathname, supabase, isLoginPage, router]);

  if (isVerifyingRoute && !isLoginPage) {
    return (
      <main className="main-content flex items-center justify-center min-h-screen">
         <div className="text-[var(--fg-dim)] text-sm animate-pulse">Consultando permissões...</div>
      </main>
    )
  }

  return (
    <>
      <Sidebar />
      <main className={`main-content ${isLoginPage ? "no-sidebar" : ""}`}>
        {children}
      </main>
    </>
  );
}
