import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const rows = await req.json();

        if (!Array.isArray(rows)) {
            return NextResponse.json({ error: "O payload deve ser um array." }, { status: 400 });
        }

        const categoryId = process.env.CONTA_AZUL_CATEGORY_ID || "1";
        const bankAccountId = process.env.CONTA_AZUL_BANK_ACCOUNT_ID || "1";
        const contaAzulApiToken = process.env.CONTA_AZUL_API_TOKEN || "SEU_TOKEN_AQUI"; // Para futura autenticação real

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const item of rows) {
            if (!item.valor || item.valor <= 0) {
                continue;
            }

            const payload = {
                date: item.dataCompetencia,
                expected_payment_date: item.dataVencimento,
                value: item.valor,
                customer_id: item.cnpj || item.cliente, // Usando CNPJ provisoriamente
                category_id: categoryId,
                bank_account_id: bankAccountId,
                description: item.descricao || "Faturamento"
            };

            try {
                // EXTT: Simulação robusta da chamada real (Remova ou ajuste com a URL oficial)
                /* 
                const response = await fetch("https://api.contaazul.com/v1/sales", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${contaAzulApiToken}`
                    },
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) {
                    throw new Error(`Erro API: ${response.statusText}`);
                }
                */

                // Simulando um delay/sucesso para desenvolvimento
                await new Promise(resolve => setTimeout(resolve, 100));

                successCount++;
            } catch (err: any) {
                errorCount++;
                errors.push({ id: item.id, cliente: item.cliente, erro: err.message });
            }
        }

        return NextResponse.json({
            message: "Sincronização concluída",
            successCount,
            errorCount,
            errors
        });

    } catch (error: any) {
        console.error("Erro na exportação para Conta Azul:", error);
        return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
    }
}
