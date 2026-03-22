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
    chave_pix?: string; // Adicionado para o match triplo
}

// Normalização do Status da Transfeera para nosso formato interno
function normalizeTransfeeraStatus(raw: string | null | undefined): TransfeeraStatus {
    if (!raw) return "NAO_SUBMETIDO";
    const s = raw.toUpperCase().trim();

    if (["FINALIZADA", "FINALIZADO", "PAGO", "CONCLUIDO", "CONCLUÍDO", "EFETIVADO"].includes(s)) {
        return "CONCLUIDO";
    }
    
    if (["FALHA", "FAILED", "ERROR", "REJEITADA", "DEVOLVIDA", "DEVOLVIDO", "RETURNED"].includes(s)) {
        return "ERRO";
    }

    if (["CRIADA", "CRIADO", "CREATED", "RECEBIDO", "AGUARDANDO_RECEBIMENTO", "EM_PROCESSAMENTO", "PROCESSANDO", "EM_PROCESSAMENTO_BANCO", "AGENDADO", "SCHEDULED"].includes(s)) {
        return "EXPORTADO";
    }
    
    if (["CANCELADA", "CANCELADO"].includes(s)) {
        return "REMOVIDO";
    }

    // Fallback de segurança 
    return "EXPORTADO";
}

export function useTransfeeraSync() {
    const supabase = createClient();
    const [statuses, setStatuses] = useState<Record<string, TransfeeraStatus>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    /**
     * Sincroniza o status de múltiplos itens baseando-se no transfeera_batch_id delegando ao backend.
     */
    const syncBatch = useCallback(async (batchId: string | null, itensLocais: SyncItem[]) => {
        if (!batchId) {
            console.log("[useTransfeeraSync] ⏭️ Lote sem transfeera_batch_id, abortando rastreio por lote.");
            return;
        }

        console.log(`[useTransfeeraSync] 🔄 Delegando sync do lote ${batchId} para o backend...`);
        setIsSyncing(true);

        try {
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
                    console.log(`[useTransfeeraSync] ✅ Sync via backend concluído com sucesso. Recarregando a interface...`);
                    // O backend já atualizou o Supabase. Apenas recarregamos para buscar o estado atual.
                    window.location.reload();
                } else {
                    console.error("[useTransfeeraSync] ⚠️ Backend respondeu com falha:", data);
                }
            } else {
                console.error("Falha ao buscar lote na action do backend:", res.status);
            }
        } catch (err) {
            console.error("Erro de rede ao sincronizar lote:", err);
        } finally {
            setIsSyncing(false);
        }
    }, []);

    /**
     * Baixa o comprovante PDF de uma transferência.
     * 
     * @param integrationId - UUID local do item
     * @param transfeeraTransferId - ID numérico da Transfeera (opcional, para consulta direta)
     */
    const downloadReceipt = useCallback(async (integrationId: string, transfeeraTransferId?: string) => {
        try {
            // Construir URL com parâmetros disponíveis
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
