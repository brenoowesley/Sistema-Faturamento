"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    LayoutDashboard,
    Users,
    Receipt,
    LogOut,
    UserCircle,
    ShieldAlert,
    Sun,
    Moon,
    Banknote,
    Activity,
    CheckCircle,
    Briefcase,
    Filter,
    SlidersHorizontal,
    FileText,
    ListPlus,
    BookOpen,
    PlusCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
const navItems = [
    { label: "Painel Principal",      href: "/",                      icon: LayoutDashboard, roles: ["ADMIN", "APROVADOR", "USER"],               exact: true },
    
    // Grupo: Faturamento
    { label: "Novo Faturamento",      href: "/faturamento/novo",       icon: PlusCircle,       roles: ["ADMIN", "APROVADOR"], isPrimary: true },
    { label: "Faturamento",           href: "/faturamento/lotes",      icon: Receipt,         roles: ["ADMIN", "APROVADOR", "USER"] },
    { label: "Triagem",               href: "/triagem",               icon: Filter,          roles: ["ADMIN", "APROVADOR"] },
    { label: "Lançamentos Parciais",  href: "/lancamentos-parciais",   icon: ListPlus,        roles: ["ADMIN", "APROVADOR"] },
    { label: "Notas de Crédito",      href: "/notas-credito",          icon: FileText,        roles: ["ADMIN", "APROVADOR"] },
    { label: "Central de Ajustes",    href: "/ajustes",                icon: SlidersHorizontal, roles: ["ADMIN", "APROVADOR"] },

    // Grupo: Saques
    { label: "Gestão de Saques",      href: "/saques",                 icon: Banknote,        roles: ["ADMIN", "APROVADOR", "USER"],               exact: true },
    { label: "Aprovação de Saques",   href: "/saques/aprovacoes",      icon: CheckCircle,     roles: ["ADMIN", "APROVADOR", "USER"] },
    { label: "Rastreio de Saques",    href: "/saques/acompanhamento",  icon: Activity,        roles: ["ADMIN", "APROVADOR", "USER", "CX"] },

    // Grupo: Cadastros
    { label: "Clientes",              href: "/clientes",               icon: Briefcase,       roles: ["ADMIN", "APROVADOR", "USER"] },

    // Grupo: Configurações e Ajuda
    { label: "Usuários",              href: "/usuarios",               icon: Users,           roles: ["ADMIN", "APROVADOR"] },
    { label: "Manual de Uso",         href: "/como-usar",              icon: BookOpen,        roles: ["ADMIN", "APROVADOR", "USER"] },
];

export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = createClient();
    const [cargo, setCargo] = useState<string | null>(null);
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        async function getRole() {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase
                    .from("usuarios_perfis")
                    .select("cargo")
                    .eq("id", user.id)
                    .single();
                setCargo(data?.cargo || "USER");
            }
        }
        getRole();
    }, [supabase]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
    };

    if (pathname === "/login") return null;

    return (
        <aside className="sidebar flex flex-col justify-between">
            {/* Top Section */}
            <div>
                {/* Brand */}
                <div className="sidebar-brand flex justify-between items-center w-full">
                    <div className="sidebar-logo-container">
                        <img
                            src={theme === 'dark' ? "https://i.imgur.com/ag93VEM.png" : "https://i.imgur.com/MKGrpJX.png"}
                            alt="IWOF Logo"
                            className="sidebar-logo-img"
                            style={{ height: "45px", width: "auto" }}
                        />
                    </div>
                    {mounted && (
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            className="p-2 rounded-full hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--fg-muted)] hover:text-[var(--fg)]"
                            title="Alternar Tema"
                        >
                            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                        </button>
                    )}
                </div>

                {/* Navigation */}
                <nav className="sidebar-nav">
                    <span className="sidebar-section-label">Menu Principal</span>
                {navItems
                        .filter(item =>
                            // Item sem roles = não existe na nova matriz (bloqueio defensivo)
                            !!item.roles && item.roles.includes(cargo || "USER")
                        )
                        .map((item) => {
                        const isActive = item.exact
                            ? pathname === item.href
                            : item.href === "/"
                                ? pathname === "/"
                                : pathname.startsWith(item.href);

                         return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`sidebar-link ${item.isPrimary ? "sidebar-link-primary" : ""} ${isActive ? "sidebar-link-active" : ""}`}
                            >
                                <item.icon size={20} />
                                <span>{item.label}</span>
                                {isActive && !item.isPrimary && <span className="sidebar-active-indicator" />}
                            </Link>
                        );
                    })}

                    <div className="mt-8">
                        <span className="sidebar-section-label">Conta e Segurança</span>

                        <Link
                            href="/perfil"
                            className={`sidebar-link ${pathname.startsWith("/perfil") ? "sidebar-link-active" : ""}`}
                        >
                            <UserCircle size={20} />
                            <span>Meu Perfil</span>
                            {pathname.startsWith("/perfil") && <span className="sidebar-active-indicator" />}
                        </Link>
                    </div>
                </nav>

                {/* Footer */}
                <div className="sidebar-footer">
                    <button
                        onClick={handleLogout}
                        className="sidebar-link sidebar-logout"
                    >
                        <LogOut size={20} />
                        <span>Sair</span>
                    </button>
                </div>
            </div>
        </aside>
    );
}
