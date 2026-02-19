
import * as xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function getEnv(key: string): string {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) return "";
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : "";
}

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ufMap: Record<string, string> = {
    "AC": "Acre",
    "AL": "Alagoas",
    "AP": "Amapá",
    "AM": "Amazonas",
    "BA": "Bahia",
    "CE": "Ceará",
    "DF": "Distrito Federal",
    "ES": "Espírito Santo",
    "GO": "Goiás",
    "MA": "Maranhão",
    "MT": "Mato Grosso",
    "MS": "Mato Grosso do Sul",
    "MG": "Minas Gerais",
    "PA": "Pará",
    "PB": "Paraíba",
    "PR": "Paraná",
    "PE": "Pernambuco",
    "PI": "Piauí",
    "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul",
    "RO": "Rondônia",
    "RR": "Roraima",
    "SC": "Santa Catarina",
    "SP": "São Paulo",
    "SE": "Sergipe",
    "TO": "Tocantins"
};

function normalizeText(text: string): string {
    if (!text) return "";
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

async function run() {
    console.log("🚀 Lendo arquivo IBGE (Rodando a partir da linha 7)...");
    const filePath = path.resolve(process.cwd(), 'RELATORIO_DTB_BRASIL_2024_MUNICIPIOS.xls');

    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];

    // Range 6 means it starts at Row 7 (0-indexed)
    const data = xlsx.utils.sheet_to_json<any>(workbook.Sheets[sheetName], { range: 6 });

    console.log(`📊 Total de municípios na planilha: ${data.length}`);

    const ibgeLookup = new Map<string, string>();
    data.forEach(row => {
        const uf = normalizeText(row["Nome_UF"]);
        const mun = normalizeText(row["Nome_Município"]);
        const code = row["Código Município Completo"];
        if (uf && mun && code) {
            ibgeLookup.set(`${uf}|${mun}`, String(code));
        }
    });

    console.log("🔍 Buscando clientes com codigo_ibge nulo...");
    const { data: clientes, error } = await supabase
        .from('clientes')
        .select('id, razao_social, cidade, estado')
        .is('codigo_ibge', null);

    if (error) {
        console.error("❌ Erro ao buscar clientes:", error);
        return;
    }

    console.log(`👥 Clientes para atualizar: ${clientes.length}`);

    let matches = 0;
    let fails = 0;

    for (const cli of clientes) {
        if (!cli.cidade || !cli.estado) {
            console.log(`⚠️ PULO: ${cli.razao_social} (Cidade/Estado ausente)`);
            fails++;
            continue;
        }

        const fullStateName = ufMap[cli.estado] || cli.estado;
        const stateNorm = normalizeText(fullStateName);
        const cityNorm = normalizeText(cli.cidade);
        const key = `${stateNorm}|${cityNorm}`;

        const ibgeCode = ibgeLookup.get(key);

        if (ibgeCode) {
            const { error: updateErr } = await supabase
                .from('clientes')
                .update({ codigo_ibge: ibgeCode })
                .eq('id', cli.id);

            if (updateErr) {
                console.error(`❌ Erro ao atualizar ${cli.razao_social}:`, updateErr);
            } else {
                console.log(`✅ MATCH: ${cli.razao_social} -> ${cli.cidade}/${cli.estado} [IBGE: ${ibgeCode}]`);
                matches++;
            }
        } else {
            console.log(`⚠️ FALHA: ${cli.razao_social} -> ${cli.cidade}/${cli.estado} (Não encontrado no IBGE)`);
            fails++;
        }
    }

    console.log("\n==================================");
    console.log(`🏁 Fim do processo.`);
    console.log(`✅ Sucessos: ${matches}`);
    console.log(`⚠️ Falhas: ${fails}`);
    console.log("==================================");
}

run();
