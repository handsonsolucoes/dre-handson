// admin.js — Área administrativa
// Só carrega se o usuário autenticado tiver role = 'admin' (verificado no banco).

import { requireAdmin, logout, supabase } from './auth.js';
import { SUPABASE_URL } from './config.js';

// ID da Edge Function de criação de usuários
const CREATE_USER_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-user-admin`;

// ─────────────────────────────────────────
// Inicialização
// ─────────────────────────────────────────
async function init() {
  // Garante que é admin — redireciona para app.html se não for
  const { session } = await requireAdmin('/app.html');

  // Salva o token JWT para usar nas chamadas à Edge Function
  window._adminToken = session.access_token;

  // Carrega dados para preencher a tela
  await Promise.all([
    loadCompanies(),
    loadUsers(),
  ]);

  hideLoading();
  bindFormEvents();
}

// ─────────────────────────────────────────
// loadCompanies — carrega empresas no <select> do formulário
// ─────────────────────────────────────────
async function loadCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name')
    .order('name');

  if (error) {
    console.error('Erro ao carregar empresas:', error.message);
    return;
  }

  // Preenche o select de empresa no formulário de criação
  const select = document.getElementById('new-user-company');
  if (select) {
    select.innerHTML =
      '<option value="">Nenhuma empresa</option>' +
      (data || []).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  // Também renderiza a lista de empresas na tela
  renderCompaniesTable(data || []);
}

// ─────────────────────────────────────────
// loadUsers — lista usuários e seus perfis
// ─────────────────────────────────────────
async function loadUsers() {
  // Busca perfis com as empresas vinculadas (join)
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id,
      full_name,
      email,
      role,
      created_at,
      user_companies (
        companies ( name )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Erro ao carregar usuários:', error.message);
    return;
  }

  renderUsersTable(data || []);
}

// ─────────────────────────────────────────
// renderUsersTable — exibe usuários em tabela
// ─────────────────────────────────────────
function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  const roleLabels = { admin: 'Administrador', analista: 'Analista', cliente: 'Cliente' };

  tbody.innerHTML = users.map(u => {
    // Extrai nomes das empresas vinculadas
    const empresas = (u.user_companies || [])
      .map(uc => uc.companies?.name)
      .filter(Boolean)
      .join(', ') || '—';

    return `
      <tr>
        <td>${escapeHtml(u.full_name || '—')}</td>
        <td>${escapeHtml(u.email || '—')}</td>
        <td>
          <span class="badge ${u.role === 'admin' ? 'badge-blue' : u.role === 'analista' ? 'badge-amber' : 'badge-green'}">
            ${roleLabels[u.role] || u.role}
          </span>
        </td>
        <td>${escapeHtml(empresas)}</td>
        <td>${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
      </tr>`;
  }).join('');
}

// ─────────────────────────────────────────
// renderCompaniesTable — lista empresas
// ─────────────────────────────────────────
function renderCompaniesTable(companies) {
  const tbody = document.getElementById('companies-tbody');
  if (!tbody) return;

  if (!companies.length) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#999">Nenhuma empresa cadastrada.</td></tr>';
    return;
  }

  tbody.innerHTML = companies.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.id)}</td>
    </tr>
  `).join('');
}

// ─────────────────────────────────────────
// bindFormEvents — conecta eventos dos formulários
// ─────────────────────────────────────────
function bindFormEvents() {
  // Formulário de criação de usuário
  const form = document.getElementById('create-user-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleCreateUser();
    });
  }

  // Formulário de criação de empresa
  const companyForm = document.getElementById('create-company-form');
  if (companyForm) {
    companyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleCreateCompany();
    });
  }

  // Botão logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
}

// ─────────────────────────────────────────
// handleCreateUser — chama a Edge Function para criar usuário
// ─────────────────────────────────────────
async function handleCreateUser() {
  const btn = document.getElementById('btn-create-user');
  const msgEl = document.getElementById('create-user-msg');

  // Lê os valores do formulário
  const full_name = document.getElementById('new-user-name')?.value.trim();
  const email = document.getElementById('new-user-email')?.value.trim().toLowerCase();
  const password = document.getElementById('new-user-password')?.value;
  const role = document.getElementById('new-user-role')?.value;
  const company_id = document.getElementById('new-user-company')?.value || null;

  // Validação básica no front (a validação real é na Edge Function)
  if (!full_name || !email || !password || !role) {
    showMsg(msgEl, 'Preencha todos os campos obrigatórios.', 'error');
    return;
  }
  if (password.length < 8) {
    showMsg(msgEl, 'A senha deve ter pelo menos 8 caracteres.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Criando...';
  showMsg(msgEl, '', '');

  try {
    // Chama a Edge Function com o JWT do admin no header
    const response = await fetch(CREATE_USER_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // O token JWT prova que quem está chamando é um admin autenticado
        'Authorization': `Bearer ${window._adminToken}`,
      },
      body: JSON.stringify({ full_name, email, password, role, company_id }),
    });

    const result = await response.json();

    if (!response.ok) {
      showMsg(msgEl, result.error || 'Erro ao criar usuário.', 'error');
      return;
    }

    showMsg(msgEl, `Usuário "${full_name}" criado com sucesso!`, 'success');
    document.getElementById('create-user-form').reset();

    // Recarrega a lista de usuários
    await loadUsers();

  } catch (err) {
    console.error(err);
    showMsg(msgEl, 'Erro de conexão. Tente novamente.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar Usuário';
  }
}

// ─────────────────────────────────────────
// handleCreateCompany — cria empresa diretamente via Supabase
// (admin tem permissão via RLS policy)
// ─────────────────────────────────────────
async function handleCreateCompany() {
  const btn = document.getElementById('btn-create-company');
  const msgEl = document.getElementById('create-company-msg');

  const name = document.getElementById('new-company-name')?.value.trim();
  const cnpj = document.getElementById('new-company-cnpj')?.value.trim() || null;
  const segment = document.getElementById('new-company-segment')?.value.trim() || null;

  if (!name) {
    showMsg(msgEl, 'Informe o nome da empresa.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = await supabase
    .from('companies')
    .insert({ name, cnpj, segment });

  if (error) {
    showMsg(msgEl, error.message || 'Erro ao criar empresa.', 'error');
  } else {
    showMsg(msgEl, `Empresa "${name}" criada!`, 'success');
    document.getElementById('create-company-form').reset();
    await loadCompanies();
  }

  btn.disabled = false;
  btn.textContent = 'Criar Empresa';
}

// ─────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────
function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = 'form-msg' + (type ? ' form-msg-' + type : '');
  el.style.display = text ? 'block' : 'none';
}

function hideLoading() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('main-content');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Inicia
document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('Erro crítico no admin:', err);
    document.getElementById('loading').textContent = 'Erro ao carregar. Recarregue a página.';
  });
});
