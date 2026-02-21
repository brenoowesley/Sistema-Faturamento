"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    LayoutDashboard,
    Users,
    FilePlus,
    SlidersHorizontal,
    Receipt,
    LogOut,
} from "lucide-react";

const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
    { label: "Clientes", href: "/clientes", icon: Users },
    { label: "Novo Faturamento", href: "/faturamento/novo", icon: FilePlus },
    { label: "Ajustes", href: "/ajustes", icon: SlidersHorizontal },
];

export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = createClient();

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
    };

    if (pathname === "/login") return null;

    return (
        <aside className="sidebar">
            {/* Brand */}
            <div className="sidebar-brand">
                <div className="sidebar-logo-container">
                    <img
                        src="https://i.imgur.com/ag93VEM.png"
                        alt="IWOF Logo"
                        className="sidebar-logo-img"
                    />
                </div>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                <span className="sidebar-section-label">Menu Principal</span>
                {navItems.map((item) => {
                    const isActive =
                        item.href === "/"
                            ? pathname === "/"
                            : pathname.startsWith(item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`sidebar-link ${isActive ? "sidebar-link-active" : ""}`}
                        >
                            <item.icon size={20} />
                            <span>{item.label}</span>
                            {isActive && <span className="sidebar-active-indicator" />}
                        </Link>
                    );
                })}
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
        </aside>
    );
}
