import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";



export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Ignorar rotas estáticas, API, auth e formulário público
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/api") ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/formulario-onus")
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



    return response;
}

export const config = {
    // Aplicar em todas as rotas, exceto arquivos estáticos
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
