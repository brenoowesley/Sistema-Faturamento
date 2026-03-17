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


export function useTransfeeraSync() {
    const [statuses, setStatuses] = useState<Record<string, TransfeeraStatus>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    const syncBatch = useCallback(async (integrationIds: string[]) => {
        if (!integrationIds || integrationIds.length === 0) return;
        
        setIsSyncing(true);
        try {
            const res = await fetch("/api/transfeera", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "status_batch",
                    ids: integrationIds,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.statuses) {
                    setStatuses((prev) => ({ ...prev, ...data.statuses }));
                }
            } else {
                console.error("Falha ao sincronizar lote Transfeera", res.status);
            }
        } catch (err) {
            console.error("Erro de rede ao sincronizar lote Transfeera:", err);
        } finally {
            setIsSyncing(false);
        }
    }, []);

    const downloadReceipt = useCallback(async (integrationId: string) => {
        try {
            // A request for the GET route of our API
            const res = await fetch(`/api/transfeera?action=receipt&id=${integrationId}`);
            
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
