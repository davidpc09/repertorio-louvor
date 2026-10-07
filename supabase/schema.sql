-- =====================================================================
-- Repertório Louvor — banco de dados (Supabase / PostgreSQL)  ·  versão 3
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode rodar de novo sem perder dados: só cria o que ainda não existe e
-- recria funções e permissões.
--
-- Segurança (Row Level Security):
--   • cada pessoa só enxerga os ministérios dos quais faz parte;
--   • administradores podem tudo; cada membro recebe permissões específicas:
--     player, musicas_adicionar, musicas_editar, musicas_remover, escala, eventos;
--   • setlists, equipe e convites: só administradores (escala: quem tem permissão);
--   • membro sempre pode responder a própria escala e enviar sugestões.
-- Convites: o administrador gera um link secreto (enviado por WhatsApp);
-- quem abre o link e cria a conta entra no ministério com o papel definido.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tabelas ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null default '',
  funcoes text[] not null default '{}',
  indisponiveis text[] not null default '{}',     -- datas AAAA-MM-DD
  tom_preferido text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.ministerios (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  nome text not null,
  config jsonb not null default '{}',             -- tipos de culto, funções, temas
  drive_pasta_id text,                            -- pasta no Google Drive (próxima fase)
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.membros (
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  pode_editar boolean not null default false,     -- membro que edita músicas sem aprovação
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (ministerio_id, usuario_id)
);
create index if not exists membros_usuario on public.membros (usuario_id);
alter table public.membros add column if not exists permissoes text[] not null default '{player}';
-- quem tinha "pode editar" (versão 2) ganha as permissões equivalentes
update public.membros set permissoes = array(select distinct unnest(permissoes || array['musicas_adicionar','musicas_editar']))
  where pode_editar and not ('musicas_editar' = any(permissoes));

create table if not exists public.convites (
  id text primary key check (length(id) >= 20),   -- código secreto do link
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  nome text not null default '',
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  pode_editar boolean not null default false,
  funcoes text[] not null default '{}',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '30 days'
);
alter table public.convites add column if not exists permissoes text[] not null default '{player}';

create table if not exists public.musicas (
  id text primary key,
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  dados jsonb not null,                           -- música completa: versões, cifra, cues, mapa, faixas
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create index if not exists musicas_min on public.musicas (ministerio_id, atualizado_em);

create table if not exists public.setlists (
  id text primary key,
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  data date,
  dados jsonb not null,                           -- itens, escala, status, observações
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create index if not exists setlists_min on public.setlists (ministerio_id, atualizado_em);

create table if not exists public.execucoes (
  id text primary key,
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  musica_id text not null references public.musicas(id) on delete cascade,
  versao_id text,
  setlist_id text references public.setlists(id) on delete cascade,  -- vazio quando veio de planilha
  data date not null,
  atualizado_em timestamptz not null default now()
);
create index if not exists execucoes_min on public.execucoes (ministerio_id, atualizado_em);

create table if not exists public.eventos (
  id text primary key,
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  data date,
  dados jsonb not null,                           -- título, tipo, horário, local, observações
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create index if not exists eventos_min on public.eventos (ministerio_id, atualizado_em);

create table if not exists public.sugestoes (
  id text primary key,
  ministerio_id text not null references public.ministerios(id) on delete cascade,
  musica_id text not null references public.musicas(id) on delete cascade,
  usuario_id uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  texto text not null,
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------- Data de atualização automática ----------
create or replace function public.tocar_atualizado() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['perfis','ministerios','membros','musicas','setlists','execucoes','sugestoes','eventos'] loop
    execute format('drop trigger if exists tg_atualizado on public.%I', t);
    execute format('create trigger tg_atualizado before insert or update on public.%I for each row execute function public.tocar_atualizado()', t);
  end loop;
end $$;

-- ---------- Funções auxiliares de permissão ----------
create or replace function public.e_membro(min text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where ministerio_id = min and usuario_id = auth.uid() and ativo);
$$;

create or replace function public.e_admin(min text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where ministerio_id = min and usuario_id = auth.uid() and ativo and papel = 'admin');
$$;

create or replace function public.pode_editar_musicas(min text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where ministerio_id = min and usuario_id = auth.uid() and ativo and (papel = 'admin' or pode_editar));
$$;

create or replace function public.tem_permissao(min text, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where ministerio_id = min and usuario_id = auth.uid() and ativo
                 and (papel = 'admin' or perm = any(permissoes)));
$$;

-- Pessoas que dividem algum ministério comigo
create or replace function public.compartilha_ministerio(outro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membros a join membros b on a.ministerio_id = b.ministerio_id
    where a.usuario_id = auth.uid() and b.usuario_id = outro);
$$;

create or replace function public.e_admin_de(outro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membros a join membros b on a.ministerio_id = b.ministerio_id
    where a.usuario_id = auth.uid() and a.papel = 'admin' and a.ativo and b.usuario_id = outro);
$$;

-- ---------- Permissões (Row Level Security) ----------
alter table public.perfis enable row level security;
alter table public.ministerios enable row level security;
alter table public.membros enable row level security;
alter table public.convites enable row level security;
alter table public.musicas enable row level security;
alter table public.setlists enable row level security;
alter table public.execucoes enable row level security;
alter table public.sugestoes enable row level security;
alter table public.eventos enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('perfis','ministerios','membros','convites','musicas','setlists','execucoes','sugestoes','eventos') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy perfis_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.compartilha_ministerio(id));
create policy perfis_editar on public.perfis for update to authenticated
  using (id = auth.uid() or public.e_admin_de(id))
  with check (id = auth.uid() or public.e_admin_de(id));

create policy ministerios_ler on public.ministerios for select to authenticated
  using (public.e_membro(id));
create policy ministerios_editar on public.ministerios for update to authenticated
  using (public.e_admin(id)) with check (public.e_admin(id));

create policy membros_ler on public.membros for select to authenticated
  using (public.e_membro(ministerio_id) or usuario_id = auth.uid());
create policy membros_admin on public.membros for all to authenticated
  using (public.e_admin(ministerio_id)) with check (public.e_admin(ministerio_id));

create policy convites_admin on public.convites for all to authenticated
  using (public.e_admin(ministerio_id)) with check (public.e_admin(ministerio_id));

create policy musicas_ler on public.musicas for select to authenticated
  using (public.e_membro(ministerio_id));
create policy musicas_adicionar on public.musicas for insert to authenticated
  with check (public.tem_permissao(ministerio_id, 'musicas_adicionar'));
create policy musicas_editar on public.musicas for update to authenticated
  using (public.tem_permissao(ministerio_id, 'musicas_editar')) with check (public.tem_permissao(ministerio_id, 'musicas_editar'));
create policy musicas_remover on public.musicas for delete to authenticated
  using (public.tem_permissao(ministerio_id, 'musicas_remover'));

create policy eventos_ler on public.eventos for select to authenticated
  using (public.e_membro(ministerio_id));
create policy eventos_editar on public.eventos for all to authenticated
  using (public.tem_permissao(ministerio_id, 'eventos')) with check (public.tem_permissao(ministerio_id, 'eventos'));

create policy setlists_ler on public.setlists for select to authenticated
  using (public.e_membro(ministerio_id) and (coalesce(dados->>'status', '') <> 'rascunho' or public.e_admin(ministerio_id)));
create policy setlists_admin on public.setlists for all to authenticated
  using (public.e_admin(ministerio_id)) with check (public.e_admin(ministerio_id));

create policy execucoes_ler on public.execucoes for select to authenticated
  using (public.e_membro(ministerio_id));
create policy execucoes_admin on public.execucoes for all to authenticated
  using (public.e_admin(ministerio_id)) with check (public.e_admin(ministerio_id));

create policy sugestoes_ler on public.sugestoes for select to authenticated
  using (usuario_id = auth.uid() or public.e_admin(ministerio_id));
create policy sugestoes_criar on public.sugestoes for insert to authenticated
  with check (usuario_id = auth.uid() and public.e_membro(ministerio_id));
create policy sugestoes_admin on public.sugestoes for update to authenticated
  using (public.e_admin(ministerio_id)) with check (public.e_admin(ministerio_id));
create policy sugestoes_apagar on public.sugestoes for delete to authenticated
  using (public.e_admin(ministerio_id));

-- ---------- Ações especiais (rodam no servidor com as verificações) ----------

-- Cria o perfil da pessoa logada, se ainda não existir
create or replace function public.garantir_perfil(p_nome text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into perfis (id, nome, email)
  values (auth.uid(), coalesce(nullif(trim(p_nome), ''), split_part(coalesce(v_email, ''), '@', 1)), coalesce(v_email, ''))
  on conflict (id) do update set
    email = excluded.email,
    nome = case when perfis.nome = '' then excluded.nome else perfis.nome end;
end $$;

-- Cria um ministério e torna quem criou administrador
create or replace function public.criar_ministerio(p_nome text, p_config jsonb default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'informe o nome do ministério'; end if;
  perform garantir_perfil(null);
  insert into ministerios (nome, config, criado_por) values (trim(p_nome), coalesce(p_config, '{}'), auth.uid())
    returning id into v_id;
  insert into membros (ministerio_id, usuario_id, papel) values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- Mostra para quem abriu o link qual ministério está convidando (sem expor mais nada)
create or replace function public.ver_convite(p_codigo text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('ministerio', m.nome, 'nome', c.nome, 'papel', c.papel)
  from convites c join ministerios m on m.id = c.ministerio_id
  where c.id = p_codigo and c.expira_em > now();
$$;

-- Usa o link de convite: entra no ministério com o papel definido pelo administrador
create or replace function public.aceitar_convite(p_codigo text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c convites%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into c from convites where id = p_codigo and expira_em > now();
  if not found then raise exception 'convite inválido ou vencido'; end if;
  perform garantir_perfil(c.nome);
  update perfis set
    funcoes = (select coalesce(array_agg(distinct f), '{}') from unnest(funcoes || c.funcoes) f)
  where id = auth.uid();
  insert into membros (ministerio_id, usuario_id, papel, pode_editar, permissoes)
  values (c.ministerio_id, auth.uid(), c.papel, c.pode_editar or 'musicas_editar' = any(c.permissoes), c.permissoes)
  on conflict (ministerio_id, usuario_id) do update set ativo = true,
    papel = case when membros.papel = 'admin' then 'admin' else excluded.papel end,
    pode_editar = membros.pode_editar or excluded.pode_editar,
    permissoes = array(select distinct unnest(membros.permissoes || excluded.permissoes));
  delete from convites where id = c.id;
  return c.ministerio_id;
end $$;

-- Membro confirma ou recusa a própria escala
create or replace function public.responder_escala(p_setlist text, p_item text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dados jsonb;
  v_min text;
  v_idx int;
begin
  if p_status not in ('confirmado', 'recusado', 'pendente') then raise exception 'situação inválida'; end if;
  select dados, ministerio_id into v_dados, v_min from setlists where id = p_setlist for update;
  if not found or not e_membro(v_min) then raise exception 'setlist não encontrado'; end if;
  select (o - 1)::int into v_idx
  from jsonb_array_elements(coalesce(v_dados->'roster', '[]')) with ordinality as e(item, o)
  where item->>'id' = p_item and item->>'userId' = auth.uid()::text;
  if v_idx is null then raise exception 'você não está nesta escala'; end if;
  update setlists set dados = jsonb_set(v_dados, array['roster', v_idx::text, 'status'], to_jsonb(p_status))
  where id = p_setlist;
end $$;

-- Quem tem a permissão "escala" monta a escala de um setlist (sem mexer nas músicas)
create or replace function public.salvar_escala(p_setlist text, p_roster jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_min text;
begin
  if jsonb_typeof(p_roster) <> 'array' then raise exception 'escala inválida'; end if;
  select ministerio_id into v_min from setlists where id = p_setlist for update;
  if not found or not tem_permissao(v_min, 'escala') then raise exception 'sem permissão para montar a escala'; end if;
  update setlists set dados = jsonb_set(dados, '{roster}', p_roster) where id = p_setlist;
end $$;

-- Sair de um ministério (o último administrador não pode sair)
create or replace function public.sair_do_ministerio(p_min text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from membros where ministerio_id = p_min and usuario_id = auth.uid() and papel = 'admin')
     and (select count(*) from membros where ministerio_id = p_min and papel = 'admin' and ativo) <= 1 then
    raise exception 'passe a administração para outra pessoa antes de sair';
  end if;
  delete from membros where ministerio_id = p_min and usuario_id = auth.uid();
end $$;

-- Impede que um ministério fique sem administrador
create or replace function public.proteger_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_min text := coalesce(old.ministerio_id, new.ministerio_id);
begin
  if (select count(*) from membros where ministerio_id = v_min and papel = 'admin' and ativo) = 0
     and exists (select 1 from ministerios where id = v_min) then
    raise exception 'o ministério precisa de pelo menos um administrador';
  end if;
  return null;
end $$;
drop trigger if exists tg_ultimo_admin on public.membros;
create constraint trigger tg_ultimo_admin after update or delete on public.membros
  deferrable initially deferred for each row execute function public.proteger_ultimo_admin();

-- ---------- Acesso pela API ----------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.perfis, public.ministerios, public.membros, public.convites,
  public.musicas, public.setlists, public.execucoes, public.sugestoes, public.eventos to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.garantir_perfil(text), public.criar_ministerio(text, jsonb), public.ver_convite(text),
  public.aceitar_convite(text), public.responder_escala(text, text, text), public.sair_do_ministerio(text),
  public.salvar_escala(text, jsonb), public.tem_permissao(text, text),
  public.e_membro(text), public.e_admin(text), public.pode_editar_musicas(text),
  public.compartilha_ministerio(uuid), public.e_admin_de(uuid) to authenticated;
-- ver_convite também pode ser chamado antes do login (só mostra o nome do ministério)
grant execute on function public.ver_convite(text) to anon;
