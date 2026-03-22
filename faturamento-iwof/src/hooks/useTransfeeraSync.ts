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
                if (data.success && data.transfers) {
                    const newStatuses: Record<string, TransfeeraStatus> = {};
                    const updatePromises = [];

                    for (const remoteTransfer of data.transfers) {
                        // Tentativa 1: Match perfeito pelo integration_id
                        let itemLocal = itensLocais.find(
                            (item) => item.id && remoteTransfer.integration_id && 
                                      String(item.id).toLowerCase() === String(remoteTransfer.integration_id).toLowerCase()
                        );

                        // Tentativa 2 (Fallback): Lotes do Excel não têm integration_id. Cruzamos por CPF e Valor.
                        if (!itemLocal) {
                            itemLocal = itensLocais.find((item) => {
                                const localCpf = String(item.cpf_favorecido || "").replace(/\D/g, "");
                                const remoteCpf = String(remoteTransfer.destination_bank_account?.cpf_cnpj || "").replace(/\D/g, "");
                                
                                const localValue = Number(item.valor_real || item.valor || 0);
                                const remoteValue = Number(remoteTransfer.value || 0);

                                return localCpf === remoteCpf && localValue === remoteValue && localCpf.length > 10;
                            });
                        }

                        if (!itemLocal) {
                            // console.warn(`[useTransfeeraSync] ⚠️ Saque ${remoteTransfer.id} não identificado localmente.`);
                            continue;
                        }

                        const normalizedStatus = normalizeTransfeeraStatus(remoteTransfer.status);
                        newStatuses[itemLocal.id.toLowerCase()] = normalizedStatus;

                        // Preparar update para o Supabase
                        const payload: any = { status_item: normalizedStatus };

                        if (remoteTransfer.id) {
                            payload.transfeera_transfer_id = String(remoteTransfer.id);
                        }
                        
                        // Se a Transfeera já gerou o link do comprovante, salvamos no banco
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
