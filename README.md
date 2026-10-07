# Repertório Louvor

App para o ministério de louvor: repertório de músicas, setlists, escala da equipe, relatórios e um player multipista com click. Funciona no iPhone, Android e computador, instalado pela tela inicial (PWA), e abre sem internet depois do primeiro acesso.

**Versão 0.4:** login de verdade e dados compartilhados entre a equipe pelo Supabase, com convites por link, permissões por pessoa e agenda. A demonstração com dados de exemplo continua disponível na tela de login. A integração com o Google Drive (áudios compartilhados) é a próxima etapa.

## Ligar a versão em nuvem (uma vez)

1. **Banco de dados:** no Supabase, abra **SQL Editor → New query**, cole todo o arquivo `supabase/schema.sql` e clique em **Run**. A cada versão nova do arquivo, rode de novo: ele só acrescenta o que falta e não apaga dados.
2. **Confirmação de e-mail:** em **Authentication → Sign In / Providers → Email**, desligue **Confirm email** e salve. O e-mail padrão do Supabase só envia mensagens para a equipe do projeto (limite de 2 por hora), então os membros não receberiam a confirmação. Quem garante o acesso é o link de convite.
3. **Endereços:** em **Authentication → URL Configuration**, deixe *Site URL* = `https://davidpc09.github.io/repertorio-louvor/` e adicione o mesmo endereço em *Redirect URLs*.
4. **Chaves:** `js/config.js` já tem a URL do projeto e a *publishable key* (públicas por natureza). Nunca coloque a *secret key* nem a senha do banco no código.

### Primeiro acesso
- O líder abre o app, toca em **Criar conta** e depois em **Criar ministério**. Quem cria vira administrador.
- Em **Equipe → Convidar pessoa**, escolhe nome, funções e papel e toca em **Gerar link**. O link vai pelo WhatsApp, vale 30 dias e serve para uma pessoa.
- Quem abre o link cria a conta e já entra no ministério, como membro ou administrador.

### Segurança
- Cada pessoa só vê os ministérios dos quais participa. O que cada membro pode fazer (músicas, escala, eventos) é conferido pelo banco (Row Level Security), não só pelo app. Setlists, equipe e convites são só dos administradores.
- O membro só consegue confirmar ou recusar a própria escala e enviar sugestões.
- Um ministério nunca fica sem administrador.
- Sem internet, o app abre com a última cópia e envia as alterações quando a conexão voltar.
- "Esqueci a senha" depende de um servidor de e-mail próprio (SMTP) no Supabase. Até lá, só funciona para os e-mails da equipe do projeto Supabase.

## O que já funciona

| Área | O que dá para fazer |
| --- | --- |
| Músicas | Cadastro com várias versões, tom original e do ministério, BPM, compasso, temas, cultos propícios, links (VS, instrumental, vozes, referência), tom por cantor |
| Cifras | Acordes acima da letra ou entre colchetes `[G]`, transposição automática, modo letra |
| Busca | Por título, artista, tema, tom; filtros por tema, culto e andamento; ordenar por "há mais tempo sem tocar" |
| Setlists | Criar com tema e observações, copiar de um anterior, reordenar, tom do dia, quem canta, alertas de repetição e de salto de tom, publicar, marcar como realizado |
| Enviar setlist | Texto pronto para WhatsApp (com negrito) ou texto simples; escolha o que entra (tons, quem canta, observações, BPM, links, tema, escala); editar antes de enviar, copiar ou baixar .txt |
| Modo culto | Tela cheia com cifra/letra no tom do dia, fonte ajustável, deslizar para a próxima música |
| Escala | Escalar por função, membro confirma ou recusa, datas indisponíveis, conflito entre ministérios |
| Importação | Planilhas `.xlsx`, `.csv`, `.ods` (o `.xls` antigo precisa ser salvo como `.xlsx`), com modelo para baixar e tratamento de duplicadas; importa também histórico |
| Relatórios | Mais e menos tocadas, nunca tocadas, esquecidas, por tema, tom, artista e participação; exporta para Excel |
| Permissões | Administrador pode tudo. Para cada membro, o administrador liga ou desliga: usar o player, adicionar, editar e remover músicas, montar escala e criar eventos. Quem não pode editar envia sugestões |
| Agenda | Cultos (setlists) e eventos (ensaios, reuniões) num só lugar; filtro “Minhas escalas”; botões para adicionar ao Google Agenda ou baixar .ics (iPhone, Outlook), um por um ou todos |
| Player | Multipistas sincronizadas, mixer (volume, mudo, solo, pan), click gerado no BPM com acento e contagem, click no lado L ou R, modo palco (música em mono no outro lado), partes por compasso com pular e repetir, escolha da saída de áudio onde o navegador permite |
| Cues e mapa | Marcadores de cada parte no estilo dos locators do Ableton Live: disparo em tempo real quantizado (tempo, compasso, 2/4/8 compassos ou fim da parte), ação ao terminar (continuar, repetir, ir para outro cue, parar), mapa programado com repetições que o player segue sozinho, pads coloridos, atalhos 1–9 e suporte a pedal de virar página |
| Tempo 0 | Forma de onda de cada faixa, detecção automática do primeiro tempo, ajuste fino por toque ou de 10 em 10 ms, grade de tempos para conferir o alinhamento |
| Offline | O app e as faixas de áudio ficam guardados no aparelho |

## Testar no seu computador

Os arquivos precisam ser abertos por um servidor (abrir o `index.html` com duplo clique não funciona, por segurança do navegador). Escolha um jeito:

- **VS Code**: instale a extensão *Live Server*, abra a pasta e clique em *Go Live*.
- **Python** (já vem no Mac e Linux): no terminal, dentro da pasta, rode `python3 -m http.server 8080` e abra `http://localhost:8080`.
- **Node**: `npx serve .`

Entre como "David (líder)" para ver tudo, ou como "Ana" para ver como um membro.

## Publicar no GitHub (de graça, com link para o celular)

1. Crie uma conta em [github.com](https://github.com) e clique em **New repository**. Nome sugerido: `repertorio-louvor`. Deixe **Public** (o GitHub Pages gratuito exige repositório público; os dados da igreja não ficam no código, ficam no aparelho de cada um).
2. Envie os arquivos. O jeito mais fácil é o app **GitHub Desktop**: *File → Add local repository*, escolha esta pasta e clique em **Publish repository**. Também dá para usar *Add file → Upload files* no site e arrastar todo o conteúdo da pasta.
3. No repositório, vá em **Settings → Pages**. Em *Build and deployment*, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)**, e salve.
4. Em um ou dois minutos aparece o endereço, algo como `https://seu-usuario.github.io/repertorio-louvor/`.
5. Abra esse endereço no celular e instale:
   - iPhone: Safari → Compartilhar → **Adicionar à Tela de Início**.
   - Android: Chrome → menu ⋮ → **Instalar app**.

Para publicar uma versão nova, altere os arquivos, aumente o número em `VERSION` no `sw.js` e envie de novo. Os aparelhos atualizam ao abrir o app.

## Usar o player

1. Abra uma música e toque em **Ensaiar no player**.
2. Na aba **Faixas e tempo 0**, adicione os arquivos da multipista de uma vez (MP3, WAV ou M4A). Se uma faixa se chamar Click ou Guia, o app usa ela para alinhar as outras.
3. Confira a linha vermelha (tempo 0) e as linhas finas (tempos seguintes). Se não estiverem sobre os ataques, toque na forma de onda ou use −10 ms / +10 ms. Se o BPM estiver errado, as linhas finas se afastam dos ataques: corrija o BPM no topo.
4. Na aba **Cues e mapa**, crie um cue para cada parte (Intro c. 1–4, Verso c. 5–12…). Também dá para tocar a música e apertar **Marcar cue aqui** no começo de cada parte. Monte o **mapa** (ex.: `Intro, Verso 1, Refrão x2, Ponte, Refrão x2, Final`).
5. Na aba **Tocar**:
   - Toque num pad (ou tecle 1–9) para disparar um cue. Com a música tocando, o salto espera a **quantização** escolhida (padrão: próximo compasso) e o pad pisca enquanto espera. Esc cancela.
   - **Seguir o mapa** faz o player ir sozinho de parte em parte, repetindo o que foi programado, sempre no compasso certo. Se o ministro decidir repetir o refrão, dispare o cue do refrão: o mapa continua dali.
   - **Repetir parte** (ou tecla L) deixa a parte atual em loop até você desligar.
   - Pedais de virar página Bluetooth (Page Down / Page Up) avançam e voltam um cue.
6. Em **Click e saída**, escolha o lado do click. No **modo palco**, o click (e a guia) sai de um lado e a música em mono do outro; com um cabo P2 → 2 P10, cada lado vai para um canal da mesa.

Limitações conhecidas: no iPhone não dá para escolher a saída de áudio dentro do app (o sistema decide) e o áudio pode parar com a tela bloqueada; o player mantém a tela acesa enquanto está aberto em navegadores que permitem. No celular, deixe ligado **Economizar memória** (faixas em mono, 24 kHz).

## Dados e backup

No modo demonstração, cada aparelho tem seus próprios dados. Em **Mais → Exportar backup** você salva um arquivo `.json` que pode ser restaurado em outro aparelho. **Recomeçar demonstração** apaga tudo e volta aos exemplos.

## Estrutura dos arquivos

```
index.html              página única do app
manifest.webmanifest    nome e ícone para instalar no celular
sw.js                   guarda o app para funcionar offline
css/app.css             visual (claro e escuro)
js/main.js              navegação, layout e entrada (login)
js/config.js            endereço do Supabase e chave pública
js/cloud/client.js      login e acesso ao banco (API REST do Supabase)
js/cloud/sync.js        sincronização, cópia offline e convites
js/store.js             dados, permissões e exemplos
js/music.js             tons, transposição, compassos
js/importer.js          leitura de CSV, XLSX e ODS sem bibliotecas
js/calendar.js          agenda, link do Google Agenda e arquivo .ics
js/audio/engine.js      motor do player (Web Audio)
js/audio/analysis.js    forma de onda e detecção do tempo 0
js/audio/cues.js        cues, quantização, ações ao terminar e mapa da música
js/audio/trackstore.js  guarda os áudios no aparelho (IndexedDB)
js/views/*.js           telas
supabase/schema.sql     banco de dados da versão em nuvem
docs/proximos-passos.md o que falta e como continuar
```

Não há etapa de build nem dependências: é HTML, CSS e JavaScript puros.
