// auth.js — Autenticação com Supabase
// Responsável por: login, logout, checar sessão, recuperar senha, redirecionamentos.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Inicializa o cliente Supabase (único, reutilizado em todo o app)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─────────────────────────────────────────
// getSession — retorna a sessão ativa ou null
// ─────────────────────────────────────────
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

// ─────────────────────────────────────────
// getUser — retorna o usuário autenticado ou null
// ─────────────────────────────────────────
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// ─────────────────────────────────────────
// requireAuth — redireciona para login se não houver sessão
// Chame isso no topo de app.html e admin.html
// ─────────────────────────────────────────
export async function requireAuth(redirectTo = '/index.html') {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo;
    // Retorna uma Promise que nunca resolve para parar a execução da página
    return new Promise(() => {});
  }
  return session;
}

// ─────────────────────────────────────────
// requireAdmin — redireciona se não for admin
// Chame isso no topo de admin.html, DEPOIS de requireAuth
// ─────────────────────────────────────────
export async function requireAdmin(redirectTo = '/app.html') {
  const session = await requireAuth();
  const profile = await getProfile(session.user.id);

  if (!profile || profile.role !== 'admin') {
    window.location.href = redirectTo;
    return new Promise(() => {});
  }
  return { session, profile };
}

// ─────────────────────────────────────────
// getProfile — busca o perfil do usuário na tabela public.profiles
// ─────────────────────────────────────────
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Erro ao buscar perfil:', error.message);
    return null;
  }
  return data;
}

// ─────────────────────────────────────────
// login — faz login com email e senha
// Retorna { success: true } ou { success: false, message: '...' }
// ─────────────────────────────────────────
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    // Traduz mensagens de erro comuns para português
    const mensagens = {
      'Invalid login credentials': 'E-mail ou senha incorretos.',
      'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
      'Too many requests': 'Muitas tentativas. Aguarde alguns minutos.',
    };
    const msg = mensagens[error.message] || 'Erro ao fazer login. Tente novamente.';
    return { success: false, message: msg };
  }

  return { success: true, session: data.session };
}

// ─────────────────────────────────────────
// logout — encerra a sessão
// ─────────────────────────────────────────
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
}

// ─────────────────────────────────────────
// sendPasswordReset — envia e-mail de redefinição de senha
// ─────────────────────────────────────────
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    {
      // Redireciona para reset-password.html, que detecta o token e exibe o formulário
      redirectTo: `${window.location.origin}/reset-password.html`,
    }
  );

  if (error) {
    return { success: false, message: 'Erro ao enviar e-mail. Verifique o endereço.' };
  }
  return { success: true };
}

// ─────────────────────────────────────────
// redirectIfLoggedIn — se já estiver logado, vai para app.html
// Use no index.html para não mostrar o login quem já está dentro
// ─────────────────────────────────────────
export async function redirectIfLoggedIn(to = '/app.html') {
  const session = await getSession();
  if (session) {
    window.location.href = to;
    return new Promise(() => {});
  }
}
