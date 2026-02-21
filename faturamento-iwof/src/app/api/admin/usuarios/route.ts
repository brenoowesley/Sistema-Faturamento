import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user: requester }, error: authError } = await supabase.auth.getUser();

        if (authError || !requester) {
            return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
        }

        // Verificar se é ADMIN
        const { data: perfil, error: perfilError } = await supabase
            .from("usuarios_perfis")
            .select("cargo")
            .eq("id", requester.id)
            .single();

        if (perfilError || perfil?.cargo !== "ADMIN") {
            return NextResponse.json({ error: "Apenas administradores podem criar usuários" }, { status: 403 });
        }

        const body = await req.json();
        const { email, password, nome, cargo } = body;

        const adminClient = createAdminClient();
        const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { nome }
        });

        if (createError) throw createError;

        // O trigger no banco deve criar o perfil, mas vamos garantir o cargo se foi passado
        if (cargo && cargo !== "USER") {
            const { error: updateError } = await adminClient
                .from("usuarios_perfis")
                .update({ cargo })
                .eq("id", newUser.user.id);

            if (updateError) console.error("Erro ao atualizar cargo:", updateError);
        }

        return NextResponse.json({ success: true, user: newUser.user });
    } catch (err: any) {
        console.error("Erro na Admin API (POST):", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user: requester } } = await supabase.auth.getUser();

        if (!requester) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

        const { data: perfil } = await supabase
            .from("usuarios_perfis")
            .select("cargo")
            .eq("id", requester.id)
            .single();

        if (perfil?.cargo !== "ADMIN") return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

        const { searchParams } = new URL(req.url);
        const userId = searchParams.get("id");

        if (!userId) return NextResponse.json({ error: "ID do usuário não fornecido" }, { status: 400 });

        const adminClient = createAdminClient();
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

        if (deleteError) throw deleteError;

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("Erro na Admin API (DELETE):", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user: requester } } = await supabase.auth.getUser();

        if (!requester) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

        const { data: perfil } = await supabase
            .from("usuarios_perfis")
            .select("cargo")
            .eq("id", requester.id)
            .single();

        if (perfil?.cargo !== "ADMIN") return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

        const body = await req.json();
        const { id, type, email } = body;

        const adminClient = createAdminClient();

        if (type === "recovery") {
            const { error: recoveryError } = await adminClient.auth.admin.generateLink({
                type: "recovery",
                email
            });
            if (recoveryError) throw recoveryError;
            return NextResponse.json({ success: true, message: "E-mail de recuperação enviado" });
        }

        if (type === "update_role") {
            const { cargo } = body;
            const { error: updateError } = await adminClient
                .from("usuarios_perfis")
                .update({ cargo })
                .eq("id", id);

            if (updateError) throw updateError;
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    } catch (err: any) {
        console.error("Erro na Admin API (PATCH):", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
