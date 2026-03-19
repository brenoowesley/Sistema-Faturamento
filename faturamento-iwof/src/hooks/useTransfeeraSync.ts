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

/**
 * Hook de sincronização com a API Transfeera.
 * 
 * Suporta dois modos de consulta:
 * 1. **Direto (rápido)**: Quando o item tem `transfeera_transfer_id`, usa `GET /transfer/{id}` diretamente.
 * 2. **Legado (varredura)**: Quando só tem o `integration_id` (UUID), varre todos os lotes paginados.
 * 
 * O chamador decide qual modo usar passando o `transfeeraIdMap` opcional para `syncBatch`.
 */
export function useTransfeeraSync() {
    const [statuses, setStatuses] = useState<Record<string, TransfeeraStatus>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    /**
     * Sincroniza o status de múltiplos itens com a Transfeera.
     * 
     * @param integrationIds - Lista de IDs dos itens (UUIDs locais, usados como chave no state)
     * @param transfeeraIdMap - Mapa opcional: `{ [integrationId]: transfeera_transfer_id }`.
     *   - IDs com match no mapa usam a consulta direta (rápida).
     *   - IDs sem match usam a varredura legado.
     */
    const syncBatch = useCallback(async (
        integrationIds: string[],
        transfeeraIdMap?: Record<string, string>
    ) => {
        if (!integrationIds || integrationIds.length === 0) return;

        setIsSyncing(true);
        try {
            // Separar IDs em dois grupos
            const directIds: string[] = [];     // Têm transfeera_transfer_id
            const legacyIds: string[] = [];     // Só têm integration_id (UUID)
            const directToLocal: Record<string, string> = {}; // transfeera_id → local_id

            for (const localId of integrationIds) {
                const transfeeraId = transfeeraIdMap?.[localId];
                if (transfeeraId) {
                    directIds.push(transfeeraId);
                    directToLocal[transfeeraId] = localId;
                } else {
                    legacyIds.push(localId);
                }
            }

            const mergedStatuses: Record<string, TransfeeraStatus> = {};

            // ── Grupo 1: Consulta direta por transfeera_transfer_id (rápida) ──
            if (directIds.length > 0) {
                try {
                    const res = await fetch("/api/transfeera", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "status_by_transfeera_id",
                            ids: directIds,
                        }),
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data.statuses) {
                            // Mapear de volta: transfeera_id → local_id
                            for (const [transfeeraId, status] of Object.entries(data.statuses)) {
                                const localId = directToLocal[transfeeraId];
                                if (localId) {
                                    mergedStatuses[localId] = status as TransfeeraStatus;
                                }
                            }
                        }
                    } else {
                        console.error("Falha ao consultar status direto Transfeera:", res.status);
                        // Marcar todos como erro
                        for (const tid of directIds) {
                            const localId = directToLocal[tid];
                            if (localId) mergedStatuses[localId] = "ERRO_CONSULTA";
                        }
                    }
                } catch (err) {
                    console.error("Erro de rede na consulta direta Transfeera:", err);
                    for (const tid of directIds) {
                        const localId = directToLocal[tid];
                        if (localId) mergedStatuses[localId] = "ERRO_REDE";
                    }
                }
            }

            // ── Grupo 2: Consulta legado por integration_id (varredura) ──
            if (legacyIds.length > 0) {
                try {
                    const res = await fetch("/api/transfeera", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "status_batch",
                            ids: legacyIds,
                        }),
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data.statuses) {
                            for (const [id, status] of Object.entries(data.statuses)) {
                                mergedStatuses[id] = status as TransfeeraStatus;
                            }
                        }
                    } else {
                        console.error("Falha ao sincronizar lote legado Transfeera:", res.status);
                    }
                } catch (err) {
                    console.error("Erro de rede na sincronização legado Transfeera:", err);
                }
            }

            // Atualizar o state com os resultados combinados
            if (Object.keys(mergedStatuses).length > 0) {
                setStatuses((prev) => ({ ...prev, ...mergedStatuses }));
            }
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
