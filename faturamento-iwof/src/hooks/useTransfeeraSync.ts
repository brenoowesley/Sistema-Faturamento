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
     * Sincroniza o status de múltiplos itens baseando-se no transfeera_batch_id.
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

        console.log(`[useTransfeeraSync] 🔄 Iniciando sync para lote ${batchId} com ${itensLocais.length} itens locais.`);
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
                
                if (data.transfers && data.transfers.length > 0) {
                    console.log("🔍 [RAIO-X] Estrutura completa das 5 transferências mais recentes:");
                    console.log(JSON.stringify(data.transfers.slice(0, 5), null, 2));
                }

                if (data.success && data.transfers) {
                    const newStatuses: Record<string, TransfeeraStatus> = {};
                    const updatePromises = [];

                    for (const remoteTransfer of data.transfers) {
                        // Extrai o ID de integração oficial que recebemos no payload
                        const remoteId = remoteTransfer.integration_id || remoteTransfer.id_integracao;
                        if (!remoteId) continue;

                        // Match 100% determinístico por UUID
                        const itemLocal = itensLocais.find(
                            (item) => item.id && String(item.id).toLowerCase() === String(remoteId).toLowerCase()
                        );

                        if (!itemLocal) continue;

                        console.log(`🔍 [MATCH PERFEITO] UUID: ${itemLocal.id} | Status: ${remoteTransfer.status}`);

                        const normalizedStatus = normalizeTransfeeraStatus(remoteTransfer.status);
                        newStatuses[itemLocal.id] = normalizedStatus;

                        // Payload de atualização para o banco de dados
                        const payload: any = { 
                            status_item: normalizedStatus,
                            transfeera_transfer_id: String(remoteTransfer.id)
                        };
                        
                        // Captura do Comprovante (as chaves vieram confirmadas no payload: bank_receipt_url e receipt_url)
                        const comprovanteLink = remoteTransfer.bank_receipt_url || remoteTransfer.receipt_url;
                        if (comprovanteLink) {
                            payload.comprovante_url = comprovanteLink;
                        }

                        updatePromises.push(
                            supabase
                                .from("itens_saque")
                                .update(payload)
                                .eq("id", itemLocal.id)
                        );
                    }

                    if (updatePromises.length > 0) {
                        const results = await Promise.all(updatePromises);
                        const errors = results.filter(r => r.error);
                        if (errors.length > 0) {
                            console.error(`[useTransfeeraSync] ❌ Falha ao salvar no Supabase:`, errors);
                        } else {
                            console.log(`[useTransfeeraSync] ✅ ${updatePromises.length} itens salvos perfeitamente no banco de dados!`);
                            
                            // ADICIONE ESTA LINHA PARA ATUALIZAR A INTERFACE IMEDIATAMENTE:
                            window.location.reload();
                        }
                    }

                    // Atualiza a tela instantaneamente
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
