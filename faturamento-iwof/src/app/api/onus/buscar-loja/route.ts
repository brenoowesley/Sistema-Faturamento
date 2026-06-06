import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const cnpj = searchParams.get("cnpj");

        if (!cnpj) {
            return NextResponse.json(
                { error: "Parâmetro 'cnpj' é obrigatório" },
                { status: 400 }
            );
        }

        const cleanCnpj = cnpj.replace(/\D/g, "");

        if (cleanCnpj.length < 3) {
            return NextResponse.json(
                { error: "CNPJ deve ter pelo menos 3 dígitos" },
                { status: 400 }
            );
        }

        const supabase = createAdminClient();

        const { data, error } = await supabase
            .from("clientes")
            .select("id, razao_social, nome_fantasia, nome_conta_azul, cnpj")
            .ilike("cnpj", "%" + cleanCnpj + "%")
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("Erro ao buscar loja por CNPJ:", error);
            return NextResponse.json(
                { error: "Erro ao buscar loja" },
                { status: 500 }
            );
        }

        if (data) {
            const nome_loja = data.nome_conta_azul || "";
            return NextResponse.json({
                found: true,
                nome_loja,
                loja: {
                    id: data.id,
                    razao_social: data.razao_social,
                    nome_fantasia: data.nome_fantasia,
                    nome_conta_azul: data.nome_conta_azul,
                    cnpj: data.cnpj,
                },
            });
        }

        return NextResponse.json({ found: false });
    } catch (err: any) {
        console.error("Erro na API buscar-loja:", err);
        return NextResponse.json(
            { error: err.message || "Erro interno" },
            { status: 500 }
        );
    }
}
