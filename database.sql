-- ============================================================
-- SQL COMPLEMENTAR — Sistema DRE Financeiro
-- Execute no Editor SQL do Supabase (em ordem)
-- ============================================================


-- ── 1. ESTRUTURA DAS TABELAS ──────────────────────────────
-- (Execute só se ainda não existirem)

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'analista' CHECK (role IN ('admin', 'analista', 'cliente')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  cnpj        TEXT,
  segment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, company_id)   -- evita duplicata
);


-- ── 2. ATIVA RLS EM TODAS AS TABELAS ─────────────────────

ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;


-- ── 3. FUNÇÃO AUXILIAR: is_admin() ───────────────────────
-- Verifica se o usuário logado é admin, consultando a tabela profiles.
-- Usada pelas policies para evitar repetição.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;


-- ── 4. POLICIES — public.profiles ────────────────────────

-- Remove policies antigas (se existirem) para recriar corretamente
DROP POLICY IF EXISTS "profiles_select_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;

-- Usuário vê apenas o próprio perfil
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Admin vê todos os perfis
CREATE POLICY "profiles_select_admin"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin());

-- Usuário pode atualizar apenas o próprio perfil (ex: trocar nome)
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Apenas a service_role (Edge Function) pode inserir novos perfis.
-- A policy abaixo é para o cliente anon/autenticado — não permite insert.
-- O INSERT vem apenas da Edge Function com service_role (bypassa RLS).


-- ── 5. POLICIES — public.companies ───────────────────────

DROP POLICY IF EXISTS "companies_select_own"   ON public.companies;
DROP POLICY IF EXISTS "companies_select_admin"  ON public.companies;
DROP POLICY IF EXISTS "companies_insert_admin"  ON public.companies;
DROP POLICY IF EXISTS "companies_update_admin"  ON public.companies;
DROP POLICY IF EXISTS "companies_delete_admin"  ON public.companies;

-- Usuário autenticado vê apenas empresas às quais está vinculado
CREATE POLICY "companies_select_own"
  ON public.companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = companies.id
        AND uc.user_id = auth.uid()
    )
  );

-- Admin vê todas as empresas
CREATE POLICY "companies_select_admin"
  ON public.companies
  FOR SELECT
  USING (public.is_admin());

-- Apenas admin pode criar empresas via front-end
CREATE POLICY "companies_insert_admin"
  ON public.companies
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Apenas admin pode editar empresas
CREATE POLICY "companies_update_admin"
  ON public.companies
  FOR UPDATE
  USING (public.is_admin());

-- Apenas admin pode deletar empresas
CREATE POLICY "companies_delete_admin"
  ON public.companies
  FOR DELETE
  USING (public.is_admin());


-- ── 6. POLICIES — public.user_companies ──────────────────

DROP POLICY IF EXISTS "uc_select_own"   ON public.user_companies;
DROP POLICY IF EXISTS "uc_select_admin"  ON public.user_companies;
DROP POLICY IF EXISTS "uc_insert_admin"  ON public.user_companies;
DROP POLICY IF EXISTS "uc_delete_admin"  ON public.user_companies;

-- Usuário vê apenas seus próprios vínculos
CREATE POLICY "uc_select_own"
  ON public.user_companies
  FOR SELECT
  USING (user_id = auth.uid());

-- Admin vê todos os vínculos
CREATE POLICY "uc_select_admin"
  ON public.user_companies
  FOR SELECT
  USING (public.is_admin());

-- Apenas admin (ou service_role via Edge Function) pode criar vínculos
CREATE POLICY "uc_insert_admin"
  ON public.user_companies
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Apenas admin pode remover vínculos
CREATE POLICY "uc_delete_admin"
  ON public.user_companies
  FOR DELETE
  USING (public.is_admin());


-- ── 7. TRIGGER: cria profile automaticamente no cadastro ──
-- Quando um usuário é criado via Edge Function (auth.users),
-- isso garante que o profile não fique órfão caso a inserção manual falhe.
-- Obs: a Edge Function já insere o profile, mas este trigger serve de fallback.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Só insere se ainda não existe (evita conflito com a Edge Function)
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'analista')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Remove trigger antigo se existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Cria o trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ── 8. GARANTE SEU USUÁRIO ADMIN ─────────────────────────
-- Substitua 'SEU_EMAIL_AQUI' pelo e-mail do seu usuário admin.
-- Execute apenas uma vez para garantir que o role esteja correto.

UPDATE public.profiles
SET role = 'admin'
WHERE email = 'SEU_EMAIL_AQUI';


-- ── 9. VERIFICAÇÃO FINAL ──────────────────────────────────
-- Rode estas queries para confirmar que está tudo certo:

-- Ver todos os profiles:
-- SELECT id, email, role FROM public.profiles;

-- Ver todas as empresas:
-- SELECT id, name FROM public.companies;

-- Ver todos os vínculos:
-- SELECT uc.user_id, p.email, c.name as empresa
-- FROM public.user_companies uc
-- JOIN public.profiles p ON p.id = uc.user_id
-- JOIN public.companies c ON c.id = uc.company_id;
