import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type TransfeeraStatus =
    | "FINALIZADO"
    | "EM_PROCESSAMENTO"
    | "AGENDADO"
    | "DEVOLVIDO"
    | "FALHA"
    | "NAO_SUBMETIDO"
    | "ERRO_CONSULTA"
    | "ERRO_REDE"
    | (string & {});

export interface SyncItem {
    id_interno: string;
    transfeera_id?: string | null;
}

// Normalização do Status da Transfeera para nosso formato interno
function normalizeTransfeeraStatus(raw: string): TransfeeraStatus {
    if (!raw) return "NAO_SUBMETIDO";
    const s = raw.toUpperCase().trim();
    const map: Record<string, TransfeeraStatus> = {
        FINALIZADO: "FINALIZADO",
        EFETIVADO: "EFETIVADO",
        PAGO: "FINALIZADO",
        CONCLUIDO: "FINALIZADO",
        CONCLUÍDO: "FINALIZADO",
        EM_PROCESSAMENTO: "EM_PROCESSAMENTO",
        PROCESSANDO: "EM_PROCESSAMENTO",
        EM_PROCESSAMENTO_BANCO: "EM_PROCESSAMENTO",
        AGENDADO: "AGENDADO",
        SCHEDULED: "AGENDADO",
        DEVOLVIDO: "DEVOLVIDO",
        RETURNED: "DEVOLVIDO",
        FALHA: "FALHA",
        FAILED: "FALHA",
        ERROR: "FALHA",
        CRIADO: "AGENDADO",
        CREATED: "AGENDADO",
    };
    return map[s] ?? (raw as TransfeeraStatus);
}

export function useTransfeeraSync() {
    const supabase = createClient();
    const [statuses, setStatuses] = useState<Record<string, TransfeeraStatus>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    /**
     * Sincroniza o status de múltiplos itens baseando-se no transfeera_batch_id.
     */
    const syncBatch = useCallback(async (batchId: string | null, items: SyncItem[]) => {
        if (!items || items.length === 0) {
            console.log("[useTransfeeraSync] ⚠️ syncBatch chamado sem itens.");
            return;
        }

        if (!batchId) {
            console.log("[useTransfeeraSync] ⏭️ Lote sem transfeera_batch_id, abortando rastreio por lote.");
            return;
        }

        console.log(`[useTransfeeraSync] 🔄 Iniciando sync para lote ${batchId} com ${items.length} itens locais.`);
        setIsSyncing(true);

        try {
            console.log("[useTransfeeraSync] 🛰️ Buscando transferências do lote...");
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
                if (data.success && data.transfers) {
                    const newStatuses: Record<string, TransfeeraStatus> = {};
                    const updatePromises = [];

                    for (const item of items) {
                        const remoteTransfer = data.transfers.find((t: any) => t.integration_id === item.id_interno);
                        
                        if (remoteTransfer) {
                            const normalizedStatus = normalizeTransfeeraStatus(remoteTransfer.status);
                            newStatuses[item.id_interno] = normalizedStatus;

                            // Preparar update para o Supabase
                            const payload: any = { status_item: normalizedStatus };
                            
                            // Se o hook descobrir um transfeera_transfer_id que não conhecíamos, salvamos ele
                            if (!item.transfeera_id && remoteTransfer.id) {
                                payload.transfeera_transfer_id = String(remoteTransfer.id);
                            }

                            updatePromises.push(
                                supabase
                                    .from("itens_saque")
                                    .update(payload)
                                    .eq("id", item.id_interno)
                            );
                        }
                    }

                    if (updatePromises.length > 0) {
                        const results = await Promise.all(updatePromises);
                        const errors = results.filter(r => r.error);
                        if (errors.length > 0) {
                            console.error(`[useTransfeeraSync] ❌ Falha ao salvar ${errors.length} atualizações no Supabase:`, errors);
                        } else {
                            console.log(`[useTransfeeraSync] ✅ ${updatePromises.length} itens atualizados com sucesso no banco.`);
                        }
                    }

                    setStatuses((prev) => ({ ...prev, ...newStatuses }));
                } else {
                    console.log(`[useTransfeeraSync] ⚠️ API respondeu com sucesso mas sem transfers.`);
                }
            } else {
                console.error("Falha ao buscar lote na Transfeera:", res.status);
            }
        } catch (err) {
            console.error("Erro de rede ao sincronizar lote:", err);
        } finally {
            setIsSyncing(false);
        }
    }, [supabase]);

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
