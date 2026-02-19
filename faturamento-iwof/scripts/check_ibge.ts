
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

async function run() {
    const { data: total, count: totalCount } = await supabase.from('clientes').select('*', { count: 'exact', head: true });
    const { data: populated, count: popCount } = await supabase.from('clientes').select('*', { count: 'exact', head: true }).not('codigo_ibge', 'is', null);

    console.log(`📊 Total de clientes: ${totalCount}`);
    console.log(`✅ Clientes com codigo_ibge: ${popCount}`);
}

run();
