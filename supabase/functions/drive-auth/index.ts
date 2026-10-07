// Função drive-auth — a ponte entre o app e o Google Drive do ministério.
//
// Por que ela existe: a autorização de longo prazo do Google (refresh token) não pode
// ficar no celular nem no código do GitHub. Ela fica guardada aqui, no servidor.
// Os membros pedem a esta função uma chave temporária (cerca de 1 hora) e, com ela,
// o celular baixa os arquivos direto do Google — o áudio não passa por este servidor.
//
// O que ela faz:
//   POST {acao:'inicio', ministerioId}  → devolve o endereço da tela de permissão do Google (só admin)
//   GET  ?code=...&state=...            → o Google volta aqui; guarda a autorização e manda de volta ao app
//   POST {acao:'token', ministerioId}   → chave temporária para baixar/enviar (qualquer membro)
//   POST {acao:'status', ministerioId}  → se está conectado e com qual conta
//   POST {acao:'desconectar', ministerioId} → apaga a autorização (só admin)
//
// Segredos a configurar no Supabase (Edge Functions → Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, STATE_SECRET, APP_URL

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const STATE_SECRET = Deno.env.get('STATE_SECRET') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Só esta permissão: arquivos que o app cria ou que o administrador abre com ele.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/drive-auth`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- "state": prova de que a volta do Google é da mesma pessoa que começou ----------
const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function signState(payload: Record<string, unknown>) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

async function readState(state: string) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || sig !== (await hmac(body))) return null;
  try {
    const p = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

// ---------- Banco ----------
/** Pergunta ao banco, usando o login de quem chamou, se a pessoa é membro/admin. */
async function autorizado(auth: string, ministerioId: string, precisaAdmin: boolean) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${precisaAdmin ? 'e_admin' : 'e_membro'}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ min: ministerioId }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

async function guardarConta(row: Record<string, unknown>) {
  const res = await admin('drive_contas?on_conflict=ministerio_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`não consegui guardar a conexão: ${await res.text()}`);
}

async function lerConta(ministerioId: string) {
  const res = await admin(`drive_contas?ministerio_id=eq.${encodeURIComponent(ministerioId)}&select=*`);
  if (!res.ok) return null;
  return (await res.json())[0] ?? null;
}

// ---------- Google ----------
async function trocarCodigo(code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'falha ao autorizar no Google');
  return data as { access_token: string; refresh_token?: string; expires_in: number };
}

async function novoAcesso(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error_description || data.error || 'falha ao renovar o acesso ao Google');
    // invalid_grant = o ministério tirou a permissão ou trocou a senha: precisa reconectar
    (e as { codigo?: string }).codigo = data.error === 'invalid_grant' ? 'reconectar' : 'google';
    throw e;
  }
  return data as { access_token: string; expires_in: number };
}

async function emailDaConta(accessToken: string) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json())?.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** Página simples mostrada ao voltar do Google, com um link de volta para o app. */
function paginaRetorno(ok: boolean, mensagem: string) {
  const destino = `${APP_URL || '/'}#/mais`;
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Drive conectado' : 'Não deu certo'}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f8;color:#1b1d24;
font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:24px}
.c{max-width:420px;text-align:center;background:#fff;border:1px solid #dfe2e9;border-radius:14px;padding:28px}
h1{font-size:1.25rem;margin:0 0 10px}p{margin:0 0 20px;color:#5f6472}
a{display:inline-block;background:#7a2e3f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#121318;color:#eceef3}.c{background:#1b1d24;border-color:#2e313c}p{color:#9ba1af}a{background:#e8909f;color:#2a0d14}}</style>
</head><body><div class="c"><h1>${ok ? 'Google Drive conectado' : 'Não foi possível conectar'}</h1>
<p>${mensagem}</p><a href="${destino}">Voltar para o app</a></div>
<script>setTimeout(function(){location.href=${JSON.stringify(destino)}},${ok ? 2500 : 8000})</script>
</body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// ---------- Entrada ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);

  try {
    if (!CLIENT_ID || !CLIENT_SECRET || !STATE_SECRET) {
      const falta = [!CLIENT_ID && 'GOOGLE_CLIENT_ID', !CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET', !STATE_SECRET && 'STATE_SECRET'].filter(Boolean).join(', ');
      const msg = `Faltam segredos na função: ${falta}.`;
      return req.method === 'GET' ? paginaRetorno(false, msg) : json({ erro: msg }, 500);
    }

    // ----- Volta do Google -----
    if (req.method === 'GET') {
      const erroGoogle = url.searchParams.get('error');
      if (erroGoogle) {
        return paginaRetorno(false, erroGoogle === 'access_denied'
          ? 'A permissão foi recusada na tela do Google. Tente de novo e toque em Permitir.'
          : `O Google respondeu: ${erroGoogle}`);
      }
      const code = url.searchParams.get('code');
      const estado = await readState(url.searchParams.get('state') ?? '');
      if (!code || !estado) return paginaRetorno(false, 'O endereço de retorno expirou ou é inválido. Comece a conexão de novo pelo app.');

      const tok = await trocarCodigo(code);
      if (!tok.refresh_token) {
        return paginaRetorno(false, 'O Google não enviou a autorização de longo prazo. Remova o acesso do app em myaccount.google.com → Segurança → Apps com acesso à sua Conta e conecte de novo.');
      }
      await guardarConta({
        ministerio_id: estado.min,
        refresh_token: tok.refresh_token,
        conta_email: await emailDaConta(tok.access_token),
        conectado_por: estado.uid ?? null,
        atualizado_em: new Date().toISOString(),
      });
      return paginaRetorno(true, 'Agora o app pode guardar as multipistas na pasta do ministério e a equipe pode baixá-las no celular.');
    }

    // ----- Chamadas do app -----
    if (req.method !== 'POST') return json({ erro: 'método não suportado' }, 405);

    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ erro: 'não autenticado' }, 401);

    const corpo = await req.json().catch(() => ({}));
    const { acao, ministerioId } = corpo as { acao?: string; ministerioId?: string };
    if (!acao || !ministerioId) return json({ erro: 'informe acao e ministerioId' }, 400);

    const precisaAdmin = acao === 'inicio' || acao === 'desconectar';
    if (!(await autorizado(auth, ministerioId, precisaAdmin))) {
      return json({ erro: precisaAdmin ? 'só administradores podem conectar ou desconectar o Drive' : 'você não participa deste ministério' }, 403);
    }

    if (acao === 'inicio') {
      let uid: string | null = null;
      try {
        uid = JSON.parse(atob(auth.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null;
      } catch { /* o uid é só informativo */ }
      const state = await signState({ min: ministerioId, uid, exp: Math.floor(Date.now() / 1000) + 900 });
      const p = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',           // garante que o Google mande a autorização de longo prazo
        include_granted_scopes: 'true',
        state,
      });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
    }

    if (acao === 'status') {
      const conta = await lerConta(ministerioId);
      return json({ conectado: !!conta, conta: conta?.conta_email ?? null, desde: conta?.conectado_em ?? null });
    }

    if (acao === 'desconectar') {
      const conta = await lerConta(ministerioId);
      if (conta?.refresh_token) {
        // avisa o Google para invalidar a autorização
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conta.refresh_token)}`, { method: 'POST' }).catch(() => {});
      }
      await admin(`drive_contas?ministerio_id=eq.${encodeURIComponent(ministerioId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return json({ ok: true });
    }

    if (acao === 'token') {
      const conta = await lerConta(ministerioId);
      if (!conta) return json({ erro: 'o Google Drive ainda não foi conectado neste ministério', codigo: 'sem_conexao' }, 409);
      try {
        const tok = await novoAcesso(conta.refresh_token);
        return json({ access_token: tok.access_token, expires_in: tok.expires_in, conta: conta.conta_email });
      } catch (e) {
        const codigo = (e as { codigo?: string }).codigo;
        if (codigo === 'reconectar') {
          return json({ erro: 'a autorização do Google expirou ou foi removida. Um administrador precisa conectar o Drive de novo.', codigo: 'reconectar' }, 409);
        }
        throw e;
      }
    }

    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('drive-auth:', msg);
    return req.method === 'GET' ? paginaRetorno(false, msg) : json({ erro: msg }, 500);
  }
});
