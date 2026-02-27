export function findCol(headers: string[], ...candidates: string[]): string | null {
    const lower = headers.map((h) => h.toLowerCase().trim());
    for (const c of candidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx >= 0) return headers[idx];
    }
    for (const c of candidates) {
        const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
        if (idx >= 0) return headers[idx];
    }
    return null;
}

export function parseDate(val: unknown): Date | null {
    if (val == null || val === "") return null;
    const s = String(val).trim();
    const num = Number(s);
    if (!isNaN(num) && num > 10000 && num < 100000) {
        const epoch = new Date(Date.UTC(1899, 11, 30));
        epoch.setUTCDate(epoch.getUTCDate() + Math.floor(num));
        const frac = num - Math.floor(num);
        const totalSeconds = Math.round(frac * 86400);
        epoch.setUTCHours(Math.floor(totalSeconds / 3600));
        epoch.setUTCMinutes(Math.floor((totalSeconds % 3600) / 60));
        epoch.setUTCSeconds(totalSeconds % 60);
        return epoch;
    }
    const dtMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (dtMatch) {
        const [, day, month, year, hour, min, sec] = dtMatch;
        return new Date(
            parseInt(year), parseInt(month) - 1, parseInt(day),
            parseInt(hour), parseInt(min), sec ? parseInt(sec) : 0
        );
    }
    const dateOnly = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dateOnly) {
        const [, day, month, year] = dateOnly;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    return null;
}

export function parseNumber(val: unknown): number {
    if (val == null || val === "") return 0;
    const s = String(val).replace(",", ".").replace(/[^\d.\-]/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

export function normalizeCnpj(raw: string): string {
    return raw.replace(/\D/g, "");
}

export function fmtCurrency(v: number): string {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtDate(d: Date | null): string {
    if (!d) return "—";
    return d.toLocaleDateString("pt-BR");
}

export function fmtTime(d: Date | null): string {
    if (!d) return "";
    return d.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
}

export const normalizarNome = (nome?: string) => {
    if (!nome) return "";
    return nome
        .trim()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
};
