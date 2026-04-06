import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* ================================================================
   GET /api/whatsapp/templates — Lista todos os templates
   ================================================================ */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ templates: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/* ================================================================
   POST /api/whatsapp/templates — Cria novo template
   ================================================================ */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nome, conteudo, categoria } = body;

    if (!nome || !conteudo) {
      return NextResponse.json(
        { error: "Nome e conteúdo são obrigatórios." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("whatsapp_templates")
      .insert({
        nome,
        conteudo,
        categoria: categoria || "FATURAMENTO",
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ template: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/* ================================================================
   PUT /api/whatsapp/templates — Atualiza um template
   ================================================================ */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, nome, conteudo, categoria } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID do template é obrigatório." },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, string> = {};
    if (nome) updatePayload.nome = nome;
    if (conteudo) updatePayload.conteudo = conteudo;
    if (categoria) updatePayload.categoria = categoria;

    const { data, error } = await supabaseAdmin
      .from("whatsapp_templates")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ template: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/* ================================================================
   DELETE /api/whatsapp/templates — Remove um template
   ================================================================ */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "ID do template é obrigatório." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("whatsapp_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
