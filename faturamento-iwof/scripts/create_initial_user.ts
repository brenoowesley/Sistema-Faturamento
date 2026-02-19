import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Carregar variáveis do .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Erro: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar no .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function createInitialUser() {
    const email = 'breno@iwof.com.br';
    const password = 'iwof@faturamento2026'; // Senha temporária, o usuário deve trocar depois

    console.log(`Tentando criar usuário: ${email}...`);

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (error) {
        if (error.message.includes('already registered')) {
            console.log('Usuário já existe. Pulando criação.');
        } else {
            console.error('Erro ao criar usuário:', error.message);
        }
    } else {
        console.log('Usuário criado com sucesso!', data.user?.id);
    }
}

createInitialUser();
