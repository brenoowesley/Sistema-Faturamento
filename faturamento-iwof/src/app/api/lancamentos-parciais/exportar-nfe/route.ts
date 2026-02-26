import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as xlsx from "xlsx";

/* ================================================================
   API ROUTE EXCLUSIVA: /api/lancamentos-parciais/exportar-nfe
   ================================================================
   ⚠️ CÓPIA ISOLADA da lógica de exportação NFE.io.
   - NÃO altera a rota original `exportar-nfe/route.ts`.
   - Recebe dados via POST {items: LancamentoParcial[]} ao invés de loteId.
   - Busca endereço/email por lojaIdentificadaId no Supabase.
   ================================================================ */

interface LancamentoExport {
    id: string;
    pedido: string;
    tipo: "NF" | "NC";
    descricao: string;
    valor: number;
    lojaIdentificadaId?: string;
    cnpj?: string;
    numeroNFGerada?: string;
    irrf?: number;
}

/** Formata número para string contábil brasileira: "1.234,56" */
function fmtContabilBR(valor: number): string {
    return Number(valor).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { items } = body as { items: LancamentoExport[] };

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "items é obrigatório." }, { status: 400 });
        }

        // Filtra apenas NF com loja identificada
        const nfItems = items.filter(i => i.tipo === "NF" && i.lojaIdentificadaId);

        if (nfItems.length === 0) {
            return NextResponse.json({ error: "Nenhum lançamento NF com loja identificada." }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // Buscar dados de endereço/email para cada loja
        const lojaIds = [...new Set(nfItems.map(i => i.lojaIdentificadaId!))];
        const { data: clientesData, error: cliErr } = await supabase
            .from("clientes")
            .select("id, razao_social, cnpj, email_principal, emails_faturamento, endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge")
            .in("id", lojaIds);

        if (cliErr) {
            console.error("[LP EXPORT] Erro ao buscar clientes:", cliErr);
            throw cliErr;
        }

        const clienteMap = new Map<string, any>();
        (clientesData || []).forEach(c => clienteMap.set(c.id, c));

        // ── Montar as 19 colunas NFE.io (cópia exata do formato original) ──
        const colunasNFE = [
            "CPF_CNPJ", "Nome", "Email", "Valor", "Codigo_Servico", "Endereco_Pais",
            "Endereco_Cep", "Endereco_Logradouro", "Endereco_Numero", "Endereco_Complemento",
            "Endereco_Bairro", "Endereco_Cidade_Codigo", "Endereco_Cidade_Nome", "Endereco_Estado",
            "Descricao", "Data_Competencia", "IBSCBS_Indicador_Operacao", "IBSCBS_Codigo_Classificacao", "NBS"
        ];

        const dadosEmitidos = nfItems
            .filter(item => item.valor > 0)
            .map(item => {
                const c = clienteMap.get(item.lojaIdentificadaId!) || {};
                const valorNF = item.valor * 0.115;

                return {
                    "CPF_CNPJ": c.cnpj ? c.cnpj.replace(/\D/g, "") : (item.cnpj || ""),
                    "Nome": c.razao_social || "",
                    "Email": c.email_principal || c.emails_faturamento || "",
                    "Valor": fmtContabilBR(valorNF),
                    "Codigo_Servico": "100202",
                    "Endereco_Pais": "BRA",
                    "Endereco_Cep": c.cep ? c.cep.replace(/\D/g, "") : "",
                    "Endereco_Logradouro": c.endereco || "",
                    "Endereco_Numero": c.numero || "",
                    "Endereco_Complemento": c.complemento || "",
                    "Endereco_Bairro": c.bairro || "",
                    "Endereco_Cidade_Codigo": c.codigo_ibge || "",
                    "Endereco_Cidade_Nome": c.cidade || "",
                    "Endereco_Estado": c.estado || "",
                    "Descricao": item.descricao || `Pedido ${item.pedido}`,
                    "Data_Competencia": new Date().toISOString().slice(0, 10),
                    "IBSCBS_Indicador_Operacao": "100301",
                    "IBSCBS_Codigo_Classificacao": "000001",
                    "NBS": "109051200",
                };
            });

        // Itens sem valor ou sem match (para segunda aba)
        const dadosNaoEmitidos = items
            .filter(i => i.tipo === "NF" && (!i.lojaIdentificadaId || i.valor <= 0))
            .map(i => ({
                "Pedido": i.pedido,
                "Descrição": i.descricao,
                "Valor": fmtContabilBR(i.valor),
                "CNPJ": i.cnpj || "Sem CNPJ",
                "Motivo": !i.lojaIdentificadaId ? "Loja não identificada" : "Valor zero ou negativo",
            }));

        // ── Gerar XLSX ──
        const workbook = xlsx.utils.book_new();

        const wsEmitida = xlsx.utils.json_to_sheet(dadosEmitidos, { header: colunasNFE });
        xlsx.utils.book_append_sheet(workbook, wsEmitida, "NF emitida");

        if (dadosNaoEmitidos.length > 0) {
            const wsNaoEmitida = xlsx.utils.json_to_sheet(dadosNaoEmitidos);
            xlsx.utils.book_append_sheet(workbook, wsNaoEmitida, "NF não emitida");
        }

        const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });

        console.log(`[LP EXPORT] Exportados ${dadosEmitidos.length} NFs, ${dadosNaoEmitidos.length} pendentes.`);

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="nfe_lancamentos_parciais_${new Date().toISOString().slice(0, 10)}.xlsx"`,
            },
        });

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Erro interno";
        console.error("[LP EXPORT] ERRO:", error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
