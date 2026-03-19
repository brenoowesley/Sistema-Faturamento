import { useState, useCallback } from "react";

export type TransfeeraStatus =
    | "FINALIZADO"
    | "EM_PROCESSAMENTO"
    | "AGENDADO"
    | "DEVOLVIDO"
    | "FALHA"
    | "NAO_SUBMETIDO"
    | "ERRO_CONSULTA"
    | "ERRO_REDE"
    | (string & {}); // Allow dynamic error strings like ERRO_401

export interface SyncItem {
    id_interno: string;
    transfeera_id?: string | null;
}

/**
 * Hook de sincronização com a API Transfeera.
 * 
 * Agora utiliza exclusivamente o rastreio otimizado via ID de transferência.
 */
export function useTransfeeraSync() {
    const [statuses, setStatuses] = useState<Record<string, TransfeeraStatus>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    /**
     * Sincroniza o status de múltiplos itens com a Transfeera.
     * 
     * @param items - Lista de objetos { id_interno, transfeera_id }
     */
    const syncBatch = useCallback(async (items: SyncItem[]) => {
        if (!items || items.length === 0) {
            console.log("[useTransfeeraSync] ⚠️ syncBatch chamado com array vazio.");
            return;
        }

        console.log(`[useTransfeeraSync] 🔄 Iniciando sync para ${items.length} itens totais.`);

        // Filtrar apenas itens que possuem ID da Transfeera
        const syncableItems = items.filter(item => !!item.transfeera_id);
        
        console.log(`[useTransfeeraSync] 🔍 Itens com transfeera_id: ${syncableItems.length}`);
        
        if (syncableItems.length === 0) {
            console.log("[useTransfeeraSync] ⏭️ Nenhum item com transfeera_id para sincronizar. Abortando.");
            return;
        }

        setIsSyncing(true);
        try {
            console.log("[useTransfeeraSync] 🛰️ Enviando requisição status_batch para o backend...");
            const res = await fetch("/api/transfeera", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "status_batch",
                    items: syncableItems,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.statuses) {
                    setStatuses((prev) => ({ ...prev, ...data.statuses }));
                }
            } else {
                console.error("Falha ao sincronizar status com Transfeera:", res.status);
            }
        } catch (err) {
            console.error("Erro de rede ao sincronizar com Transfeera:", err);
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
