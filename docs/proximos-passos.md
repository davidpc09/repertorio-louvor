# Próximos passos

A versão 0.1 cobre a Fase 1 inteira e boa parte das Fases 3 e 4 da especificação, rodando só no aparelho. O que falta para a equipe usar de verdade, em ordem:

## 1. Dados na nuvem (Supabase) — prioridade

Hoje cada aparelho tem seus próprios dados. Para o setlist que o líder monta aparecer no celular de todos:

1. Criar conta grátis em supabase.com e um projeto (região São Paulo).
2. SQL Editor → colar `supabase/schema.sql` → Run.
3. Authentication → Providers: ligar E-mail e Google.
4. Trocar `js/store.js` para ler e gravar no Supabase em vez do `localStorage` (as funções `commit`, `load` e as consultas já estão concentradas nesse arquivo, então a mudança fica num lugar só).
5. Trocar a tela `js/views/login.js` por login com e-mail/senha e Google.

O que precisa de você: criar a conta do Supabase e me passar a URL do projeto e a chave pública (anon key). Nunca coloque a chave secreta (service_role) no código.

## 2. Google Drive (Fase 2)

- Conectar a conta Google da igreja uma vez (admin).
- Criar automaticamente `Repertório Louvor/<Música>/<Versão>/VS | Instrumental | Vozes | Cifras`.
- Upload das multipistas pelo app indo direto para a pasta certa; o app baixa para o aparelho e guarda offline.
- Precisa de uma função de servidor (Supabase Edge Function) para guardar a autorização com segurança, e de um projeto no Google Cloud com a Drive API ligada.

O que precisa de você: a conta Google da igreja e, depois, aprovar a tela de permissão do Google.

## 3. Avisos da escala

Notificações no celular (app instalado) e por e-mail quando alguém é escalado, e lembrete dois dias antes para quem não respondeu.

## 4. Melhorias no player

- Mapa de tempo para músicas que mudam de andamento.
- Velocidade de estudo (ex.: 80%) sem mudar o tom.
- Marcar cues direto na forma de onda.
- Controle por MIDI (pedaleira/controlador USB) no computador, pela Web MIDI.
- Cues com ponto fora do compasso inteiro (anacruse) e trocas de BPM por cue.

## Decisões já tomadas (da especificação)

- Membros sugerem alterações; o admin aprova e pode liberar edição direta por membro.
- Vários ministérios, cada um com repertório e equipe; uma pessoa pode estar em mais de um.
- Áudio fica no Google Drive e é baixado para o aparelho; sem cópia no Supabase.
- A escala entra no escopo.
- Importação: Título e Artista obrigatórios; demais colunas opcionais.
