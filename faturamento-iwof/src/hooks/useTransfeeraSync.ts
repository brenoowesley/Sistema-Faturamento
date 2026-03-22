import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface SyncItem {
    id: string;
    transfeera_id?: string | null;
}

export function useTransfeeraSync() {
    const supabase = createClient();
    const [isSyncing, setIsSyncing] = useState(false);

    const syncBatch = useCallback(async (batchId: string | null, itensLocais: SyncItem[]) => {
        if (!batchId || !itensLocais || itensLocais.length === 0) return false;

        setIsSyncing(true);
        try {
            const res = await fetch("/api/transfeera", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "status_by_batch_id", batchId }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    return true; // Sucesso! O backend já atualizou o banco.
                }
            }
        } catch (err) {
            console.error("Erro de rede ao sincronizar lote:", err);
        } finally {
            setIsSyncing(false);
        }
        return false;
    }, []);

    const downloadReceipt = useCallback(async (integrationId: string, transfeeraTransferId?: string) => {
        try {
            const params = new URLSearchParams({ action: "receipt" });
            if (transfeeraTransferId) params.set("transfer_id", transfeeraTransferId);
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
            console.error("Erro ao descarregar:", err);
        }
    }, []);

    return { isSyncing, syncBatch, downloadReceipt };
}
