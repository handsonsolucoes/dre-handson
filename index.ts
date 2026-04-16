// supabase/functions/create-user-admin/index.ts
//
// Edge Function para criação administrativa de usuários.
// Roda no servidor do Supabase — a service_role key NUNCA chega ao browser.
//
// Como funciona:
//   1. O admin autenticado chama esta função com seu JWT no header.
//   2. A função verifica que o JWT é válido E que o usuário é admin.
//   3. Só então usa o cliente admin (service_role) para criar o usuário.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers — ajuste a origem para seu domínio em produção
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Perfis válidos
const VALID_ROLES = ['admin', 'analista', 'cliente'];

serve(async (req) => {
  // Responde ao preflight do CORS (requisição OPTIONS do browser)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    // ── 1. Extrai o JWT do header Authorization ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Token de autenticação não fornecido.' }, 401);
    }
    const callerToken = authHeader.replace('Bearer ', '');

    // ── 2. Cria cliente com o JWT do chamador (não o service_role) ──
    // Isso verifica que o token é válido de forma segura.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // só existe no servidor

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    // ── 3. Identifica quem está chamando ──
    const { data: { user: callerUser }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !callerUser) {
      return json({ error: 'Token inválido ou expirado. Faça login novamente.' }, 401);
    }

    // ── 4. Verifica no banco se o chamador é admin ──
    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Acesso negado. Apenas administradores podem criar usuários.' }, 403);
    }

    // ── 5. Lê e valida o corpo da requisição ──
    let body: { full_name?: string; email?: string; password?: string; role?: string; company_id?: string | null };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Corpo da requisição inválido (JSON esperado).' }, 400);
    }

    const { full_name, email, password, role, company_id } = body;

    if (!full_name?.trim())   return json({ error: 'Nome completo é obrigatório.' }, 400);
    if (!email?.trim())       return json({ error: 'E-mail é obrigatório.' }, 400);
    if (!password)            return json({ error: 'Senha é obrigatória.' }, 400);
    if (password.length < 8)  return json({ error: 'Senha deve ter pelo menos 8 caracteres.' }, 400);
    if (!role)                return json({ error: 'Perfil (role) é obrigatório.' }, 400);
    if (!VALID_ROLES.includes(role)) {
      return json({ error: `Perfil inválido. Use: ${VALID_ROLES.join(', ')}.` }, 400);
    }

    // ── 6. Cria cliente admin (service_role) — só no servidor ──
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 7. Verifica se empresa existe (se foi fornecida) ──
    if (company_id) {
      const { data: company, error: compErr } = await adminClient
        .from('companies')
        .select('id')
        .eq('id', company_id)
        .single();

      if (compErr || !company) {
        return json({ error: 'Empresa não encontrada. Verifique o ID.' }, 400);
      }
    }

    // ── 8. Cria o usuário no Supabase Auth ──
    const { data: newAuthUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true, // já confirma automaticamente (admin criou)
    });

    if (createErr) {
      // Mensagem amigável para e-mail duplicado
      const isDuplicate = createErr.message.toLowerCase().includes('already') ||
                          createErr.message.toLowerCase().includes('duplicate');
      return json({
        error: isDuplicate
          ? 'Este e-mail já está cadastrado no sistema.'
          : `Erro ao criar autenticação: ${createErr.message}`,
      }, 400);
    }

    const newUserId = newAuthUser.user!.id;

    // ── 9. Cria o perfil em public.profiles ──
    const { error: profileInsertErr } = await adminClient
      .from('profiles')
      .insert({
        id: newUserId,
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        role,
      });

    if (profileInsertErr) {
      // Rollback: remove o usuário de auth se o profile falhar
      await adminClient.auth.admin.deleteUser(newUserId);
      return json({ error: `Erro ao criar perfil: ${profileInsertErr.message}` }, 500);
    }

    // ── 10. Vincula o usuário à empresa (se fornecida) ──
    if (company_id) {
      const { error: linkErr } = await adminClient
        .from('user_companies')
        .insert({ user_id: newUserId, company_id });

      if (linkErr) {
        // Não faz rollback aqui — usuário foi criado, apenas o vínculo falhou.
        // Admin pode vincular manualmente depois.
        console.warn('Aviso: vínculo com empresa falhou:', linkErr.message);
      }
    }

    // ── 11. Responde com sucesso ──
    return json({
      success: true,
      user_id: newUserId,
      message: `Usuário "${full_name}" criado com sucesso.`,
    }, 201);

  } catch (err) {
    console.error('Erro inesperado na Edge Function:', err);
    return json({ error: 'Erro interno do servidor. Tente novamente.' }, 500);
  }
});

// Função auxiliar para retornar JSON com headers corretos
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
