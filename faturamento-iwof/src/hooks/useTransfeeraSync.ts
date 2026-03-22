import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type TransfeeraStatus =
    | "CONCLUIDO"
    | "EXPORTADO"
    | "AGENDADO"
    | "ERRO"
    | "NAO_SUBMETIDO"
    | "ERRO_CONSULTA"
    | "ERRO_REDE"
    | "REMOVIDO"
    | (string & {});

export interface SyncItem {
    id: string;
    transfeera_id?: string | null;
    cpf_favorecido?: string;
    valor_real?: number;
    valor?: number;
    chave_pix?: string;
}

export function useTransfeeraSync() {
    const supabase = createClient();
    const [statuses, setStatuses] = useState<Record<string, TransfeeraStatus>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    /**
     * Sincroniza o status pedindo para o backend fazer o update com poderes de Admin.
     */
    const syncBatch = useCallback(async (batchId: string | null, itensLocais: SyncItem[]) => {
        if (!itensLocais || itensLocais.length === 0) {
            console.log("[useTransfeeraSync] ⚠️ syncBatch chamado sem itens.");
            return;
        }

        if (!batchId) {
            console.log("[useTransfeeraSync] ⏭️ Lote sem transfeera_batch_id, abortando rastreio por lote.");
            return;
        }

        console.log(`[useTransfeeraSync] 🔄 Iniciando sync para lote ${batchId}...`);
        setIsSyncing(true);

        try {
            console.log("[useTransfeeraSync] 🛰️ Solicitando sincronização ao backend...");
            const res = await fetch("/api/transfeera", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "status_by_batch_id",
                    batchId,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    console.log(`[useTransfeeraSync] ✅ Sincronização concluída pelo Backend! Atualizando tela para puxar dados frescos...`);
                    // O backend já salvou tudo no banco com segurança. 
                    // Agora apenas recarregamos a página para o React puxar os dados novos.
                    window.location.reload(); 
                } else {
                    console.error(`[useTransfeeraSync] ⚠️ API falhou internamente:`, data.error);
                }
            } else {
                console.error("Falha ao comunicar com a Transfeera:", res.status);
            }
        } catch (err) {
            console.error("Erro de rede ao sincronizar lote:", err);
        } finally {
            setIsSyncing(false);
        }
    }, []);

    /**
     * Baixa o comprovante PDF de uma transferência.
     */
    const downloadReceipt = useCallback(async (integrationId: string, transfeeraTransferId?: string) => {
        try {
            const params = new URLSearchParams({ action: "receipt" });
            if (transfeeraTransferId) {
                params.set("transfer_id", transfeeraTransferId);
            }
            params.set("id", integrationId);

            const res = await fetch(`/api/transfeera?${params.toString()}`);

            if (!res.ok) {
                const errorData = await res.json();
                alert(`Não foi possível descarregar: ${errorData.error || "Erro Desconhecido"}`);
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `comprovativo_${integrationId.slice(0, 8)}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Erro ao descarregar comprovativo:", err);
            alert("Erro de rede ao tentar descarregar o comprovativo.");
        }
    }, []);

    return {
        statuses,
        isSyncing,
        syncBatch,
        downloadReceipt
    };
}
