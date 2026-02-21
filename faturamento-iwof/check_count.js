require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data } = await supabase.from('faturamentos_lote').select('id').order('criado_em', { ascending: false }).limit(1);

    if (data && data[0]) {
        const loteId = data[0].id;
        console.log('Lote ID:', loteId);

        const { data: agendamentos } = await supabase
            .from('agendamentos_brutos')
            .select('loja_id, ref_agendamento')
            .eq('lote_id', loteId)
            .eq('status_validacao', 'VALIDADO');

        if (!agendamentos) {
            console.log('No agendamentos found.');
            return;
        }

        console.log('Total agendamentos validados (linhas):', agendamentos.length);

        const uniqueLojas = new Set(agendamentos.map(x => x.loja_id));
        console.log('Total de lojas únicas (loja_id):', uniqueLojas.size);

        const uniqueCnpjs = new Set(agendamentos.map(x => x.ref_agendamento));
        console.log('Total de CNPJs únicos da planilha (ref_agendamento):', uniqueCnpjs.size);
    }
}

run();
