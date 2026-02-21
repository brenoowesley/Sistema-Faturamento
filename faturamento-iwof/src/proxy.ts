import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Atualizar a sessão se expulsa
    const {
        data: { user },
    } = await supabase.auth.getUser()

    // Proteger rotas (exceto login)
    const isLoginPage = request.nextUrl.pathname.startsWith('/login')
    const isPublicFile = request.nextUrl.pathname.match(/\.(.*)$/) // imagens, fontes, etc.
    const isAuthCallback = request.nextUrl.pathname.startsWith('/auth/callback')

    if (!user && !isLoginPage && !isPublicFile && !isAuthCallback) {
        // Redirecionar para login
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Redirecionar logado tentando acessar login
    if (user && isLoginPage) {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
    }

    // RBAC: Proteger rotas administrativas
    if (user && request.nextUrl.pathname.startsWith('/usuarios')) {
        const { data: perfil } = await supabase
            .from('usuarios_perfis')
            .select('cargo')
            .eq('id', user.id)
            .single()

        if (perfil?.cargo !== 'ADMIN') {
            const url = request.nextUrl.clone()
            url.pathname = '/'
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
