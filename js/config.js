// Configuração da versão em nuvem (Supabase).
// Estas duas informações são PÚBLICAS por natureza e podem ficar no GitHub:
// a segurança vem das permissões do banco (supabase/schema.sql), não do segredo destas chaves.
// NUNCA coloque aqui a "secret key" (sb_secret_...) nem a senha do banco.
export const SUPABASE_URL = 'https://tydhobofumotidcadiby.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Q_ZppS_5ZcCBP8VP2H0IMQ_xA06kGke';

// Endereço público do app (usado nos links de convite e de redefinição de senha).
// Se ficar vazio, usa o endereço em que o app foi aberto.
export const APP_URL = '';

// Google Client ID (público) — usado na integração com o Google Drive.
// O Client Secret fica SOMENTE nos segredos da Edge Function, nunca no código.
export const GOOGLE_CLIENT_ID = '454108544865-ag5615gks18hake2h587g80q1lpg6ks8.apps.googleusercontent.com';

// Entrar com Google: fica desligado até configurarmos o Google Cloud (próxima fase).
export const GOOGLE_LOGIN = false;
