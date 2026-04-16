// app.js — Dashboard protegido
// Valida sessão, carrega perfil e empresas do usuário, preenche a tela.

import { requireAuth, getProfile, logout, supabase } from './auth.js';

// ─────────────────────────────────────────
// Inicialização — executa quando a página carrega
// ─────────────────────────────────────────
async function init() {
  // 1. Garante que há sessão válida (redireciona se não houver)
  const session = await requireAuth('/index.html');
  const user = session.user;

  // 2. Busca o perfil do usuário na tabela public.profiles
  const profile = await getProfile(user.id);
  if (!profile) {
    showError('Perfil não encontrado. Contate o administrador.');
    return;
  }

  // 3. Preenche as informações básicas do usuário na tela
  setElement('user-email', user.email);
  setElement('user-name', profile.full_name || user.email);
  setElement('user-role', formatRole(profile.role));

  // Mostra o link de admin na navegação se o usuário for admin
  const adminLink = document.getElementById('admin-link');
  if (adminLink) {
    adminLink.style.display = profile.role === 'admin' ? 'inline-block' : 'none';
  }

  // 4. Busca as empresas vinculadas ao usuário
  await loadUserCompanies(user.id);

  // 5. Aqui você integrará a lógica da DRE (filtro por empresa vinculada)
  await loadDRESection(user.id, profile.role);

  // 6. Esconde o loading e mostra o conteúdo
  hideLoading();
}

// ─────────────────────────────────────────
// loadUserCompanies — busca empresas do usuário via join
// ─────────────────────────────────────────
async function loadUserCompanies(userId) {
  // Busca na tabela user_companies com join em companies
  const { data, error } = await supabase
    .from('user_companies')
    .select(`
      company_id,
      companies (
        id,
        name,
        cnpj,
        segment
      )
    `)
    .eq('user_id', userId);

  if (error) {
    console.error('Erro ao buscar empresas:', error.message);
    setElement('companies-list', '<p class="text-muted">Erro ao carregar empresas.</p>');
    return [];
  }

  // Extrai apenas os objetos de company
  const companies = (data || [])
    .map(row => row.companies)
    .filter(Boolean);

  // Renderiza na tela
  renderCompanies(companies);

  // Retorna a lista para uso em outras funções (ex: seletor de empresa na DRE)
  return companies;
}

// ─────────────────────────────────────────
// renderCompanies — exibe as empresas na tela
// ─────────────────────────────────────────
function renderCompanies(companies) {
  const container = document.getElementById('companies-list');
  if (!container) return;

  if (!companies.length) {
    container.innerHTML = '<p class="text-muted">Nenhuma empresa vinculada.</p>';
    return;
  }

  container.innerHTML = companies.map(c => `
    <div class="company-card" data-id="${c.id}">
      <div class="company-avatar">${getInitials(c.name)}</div>
      <div class="company-info">
        <div class="company-name">${escapeHtml(c.name)}</div>
        <div class="company-meta">${escapeHtml(c.segment || '—')}${c.cnpj ? ' · ' + escapeHtml(c.cnpj) : ''}</div>
      </div>
    </div>
  `).join('');
}

// ─────────────────────────────────────────
// loadDRESection — placeholder para integração da DRE
// Adapte aqui para chamar a lógica existente do seu sistema DRE
// ─────────────────────────────────────────
async function loadDRESection(userId, role) {
  // Busca IDs de empresa permitidos para este usuário
  // (admin pode ver tudo; analista/cliente só vê as vinculadas)
  const { data } = await supabase
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId);

  const allowedCompanyIds = (data || []).map(r => r.company_id);

  // Armazena na janela para uso pelo módulo DRE existente
  window.ALLOWED_COMPANY_IDS = allowedCompanyIds;
  window.USER_ROLE = role;

  // O módulo DRE deve sempre verificar window.ALLOWED_COMPANY_IDS
  // antes de exibir qualquer dado de empresa
  console.log('Empresas permitidas:', allowedCompanyIds);
}

// ─────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────
function setElement(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function hideLoading() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('main-content');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  hideLoading();
}

function formatRole(role) {
  const roles = { admin: 'Administrador', analista: 'Analista', cliente: 'Cliente' };
  return roles[role] || role;
}

function getInitials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Botão de logout
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-logout');
  if (btn) btn.addEventListener('click', logout);

  // Inicia o app
  init().catch(err => {
    console.error('Erro crítico:', err);
    showError('Erro inesperado. Recarregue a página.');
  });
});
