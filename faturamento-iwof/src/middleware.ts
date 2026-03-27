import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rotas bloqueadas para o papel CX (apenas Rastreio, Perfil e Sair são permitidos)
const CX_BLOCKED_PREFIXES = [
    "/",
    "/faturamento",
    "/saques/aprovacoes",
    "/saques",
    "/clientes",
    "/usuarios",
    "/triagem",
    "/notas-credito",
    "/lancamentos-parciais",
    "/ajustes",
    "/como-usar",
];

// Rota permitida exclusivamente pelo CX que não deve ser bloqueada
const CX_ALLOWED_PREFIX = "/saques/acompanhamento";

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Ignorar rotas estáticas, API e auth
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/api") ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth")
    ) {
        return NextResponse.next();
    }

    // Criar cliente Supabase com cookies do request
    const response = NextResponse.next({
        request: { headers: request.headers },
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // Se não autenticado, redirecionar para login (exceto se já estiver lá)
    if (!user && pathname !== "/login") {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    if (user) {
        // Buscar o cargo do utilizador
        const { data: perfil } = await supabase
            .from("usuarios_perfis")
            .select("cargo")
            .eq("id", user.id)
            .single();

        const cargo = perfil?.cargo || "USER";

        // ── Aplicar regras do CX ──────────────────────────────────────────────
        if (cargo === "CX") {
            // CX só pode acessar /saques/acompanhamento e /perfil
            const isCxAllowed =
                pathname.startsWith(CX_ALLOWED_PREFIX) ||
                pathname.startsWith("/perfil");

            if (!isCxAllowed) {
                return NextResponse.redirect(new URL(CX_ALLOWED_PREFIX, request.url));
            }
        }
    }

    return response;
}

export const config = {
    // Aplicar em todas as rotas, exceto arquivos estáticos
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
