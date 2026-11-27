# Consulta DANFE

Aplicacao desktop para Windows que:

- consulta XMLs por chave via `consultadanfe.com`;
- usa API direta como caminho principal;
- oferece fallback pelo site para chaves validas que terminarem com falha;
- aceita entrada manual de chaves;
- extrai chaves de PDFs da DANFE;
- le planilhas `CSV`, `XLSX`, `XLSM` e `XLS`;
- procura automaticamente a coluna com cabecalho `Chave de Acesso` na primeira linha;
- salva os XMLs em uma pasta local escolhida no app, separados por CNPJ, mes de emissao e entradas/saidas.

Sem certificado, antes de cada processamento (chaves, PDFs ou planilhas), um popup permite escolher:

- **Entradas**: usa o CNPJ informado ou, se vazio, o CNPJ do destinatario do XML.
- **Saidas**: usa o CNPJ informado ou, se vazio, o CNPJ do emitente da chave.
- **Identificar pelo CNPJ**: exige o CNPJ da empresa e classifica cada XML como saida
  quando ela e emitente, ou entrada quando ela e destinataria. Notas sem esse vinculo
  geram erro e nao sao salvas nessa empresa.

Os novos downloads usam `pasta escolhida/CNPJ/AAAA-MM/entradas ou saidas/chave.xml` em
todos os modos de consulta (API, site e certificado), inclusive nas tentativas automaticas.
Sem certificado, o periodo usa a data de emissao do XML e, se ela estiver ausente, a competencia da chave.
Com certificado, nao ha popup de classificacao: o CNPJ extraido do certificado identifica a empresa,
e os campos `emit/CNPJ`, `dest/CNPJ` e `dhEmi` (ou `dEmi`) do XML definem entradas/saidas e periodo.
Essa regra tambem acompanha o cache NSU e as tentativas pela API e pelo site. XMLs sem emitente,
data de emissao ou vinculo com a empresa retornam erro, sem salvar em uma pasta incorreta.
Cancelar ou fechar o popup interrompe o inicio da rodada.
Arquivos ja baixados permanecem no local original.

## Acesso local ao abrir o aplicativo

A abertura apresenta a tela de login. No primeiro acesso, escolha um login e uma senha de pelo menos oito caracteres e confirme a senha no diálogo de cadastro. Não existe usuário ou senha padrão. Após a validação, o aplicativo abre o menu. O botão **Notas Manuais** leva à consulta de chaves existente. **Notas Automáticas** abre a tela com seus seletores. **Planilhas de Chaves** abre a coleta e a listagem das planilhas por empresa e período.

A opção **salvar** preenche login e senha na próxima abertura, sem entrar automaticamente. No aplicativo desktop, esses dados são criptografados com `safeStorage` do Electron, usando a proteção do Windows. Desmarcar a opção remove o preenchimento salvo. No acesso por navegador, o salvamento pela aplicação fica desabilitado.

O cadastro guarda somente o verificador de senha com sal e scrypt em `%LOCALAPPDATA%/ConsultaDanfeAutomacao/local-user.json`. O preenchimento salvo fica criptografado em `remembered-login.bin` na mesma pasta. Esses dados não usam os diretórios temporários alternativos do processamento de XMLs. A sessão tem validade de oito horas, fica em memória e usa cookie HttpOnly/SameSite Strict; reabrir o aplicativo apresenta o login.

As rotas de menu, consultas, configuração, arquivos e relatórios exigem sessão válida. As operações nativas de seleção de pasta e certificado também verificam a sessão. O login do sistema é independente dos certificados e dos acessos a portais fiscais. Esta etapa oferece um acesso local por instalação/perfil Windows; não inclui múltiplos usuários, recuperação de senha ou serviço centralizado.

Login e menu usam janelas transparentes, sem fundo externo, com dimensões iniciais próprias. O menu abre em `603 × 580`; a seleção de Notas Manuais abre a janela de consultas, opaca. O layout do menu fica em `public/menu.html`, `public/menu.css` e `public/menu.js`, reaproveitando a moldura de `public/login.css`.

A base de Notas Automáticas abre em `1052 × 589`, também com transparência externa, fundo `#131214` e moldura compartilhada. Seus arquivos são `public/automatic-notes.html`, `public/automatic-notes.css` e `public/automatic-notes.js`. O espaço `#automaticNotesContent` contém a barra lateral com os ícones de empresas, calendário e filtro de notas, usando as imagens fornecidas pelo usuário em `public/assets/automatic-notes/`. As imagens têm 36 px de largura, proporções preservadas e espaçamento vertical de 16 px. Os três ícones abrem seus seletores; a abertura dessa tela não executa consultas fiscais ou agendamentos.

O calendário abre ao passar o mouse pelo ícone e permanece aberto durante a passagem para o pop-up. A grade começa no domingo, acompanha o mês e ano escolhidos e considera anos bissextos. A data atual usa o fuso de Salvador. Dois cliques em dias diferentes selecionam o intervalo inclusivo, em qualquer ordem. Um terceiro clique inicia outro intervalo; clicar novamente no único dia selecionado limpa a seleção. Um único dia representa uma consulta desse dia; sem seleção, o período é o mês inteiro. Mudar mês ou ano limpa a seleção. O botão Buscar emite `calendar-period:search` com `{ period: { year, month, startDate, endDate, mode, available }, company }`, usando a empresa compartilhada; a execução da consulta será implementada depois. O estado compartilhado está em `calendarPeriodContext`, e o modelo de datas em `public/calendar-period-model.mjs`.

No mês em curso, todos os dias permanecem selecionáveis, inclusive depois da última busca. O calendário informa que o retorno contém apenas os dados processados até a última busca concluída e exibe sua data, usando `lastCompletedQueryAt` no fuso de Salvador. Sem conclusão registrada, informa a ausência e mantém a seleção disponível. O evento preserva `startDate` e `endDate` solicitados; `lastCompletedDate` informa a última conclusão e `processedEndDate` limita os dados disponíveis (ou é nulo se não houver interseção com o período). Meses encerrados continuam abrangendo todo o mês. Trocar de empresa limpa a seleção e atualiza o aviso. O catálogo oferece `recordQueryCompletion(companyId, completedAt)` para o futuro processador registrar a conclusão bem-sucedida, de forma persistente e sem retroceder o marcador; iniciar uma busca, selecionar datas, falhar ou cancelar não chama esse método. A execução das consultas automáticas permanece para a próxima etapa.

O filtro de notas abre pelo terceiro ícone com o mesmo comportamento de hover e usa o design amarelo de `seletor notas.png`. A rota autenticada `GET /api/note-filter` confere os XMLs na pasta configurada para downloads e subpastas, sem alterar arquivos ou consultar serviços externos. Só lista empresas cadastradas cujo CNPJ completo seja o emitente de notas reconhecidas e baixadas. NF-e e NFC usam modelos 55 e 65 com protocolo autorizado; NFS reconhece os documentos locais `CompNfse/Nfse/InfNfse` e `NFSe/infNFSe` com número e CNPJ do prestador. Outros formatos municipais poderão exigir adaptadores quando a integração NFS-e for implementada. Resumos, RPS, DPS, XML inválido, arquivos acima de 12 MB, atalhos e diagnósticos não habilitam ações. Falhas de leitura são informadas, sem apresentar um resultado parcial como catálogo completo.

A empresa escolhida no filtro usa o mesmo `companyContext`. Os botões NF-e, NFS e NFC verificam a existência do seu próprio tipo; sem notas, o clique ou Enter toca um aviso curto e não emite a ação. Esses botões usam `aria-disabled` para comunicar indisponibilidade e ainda permitir o aviso sonoro solicitado. Com notas, emitem `note-filter:request` com `{ type: 'nfe' | 'nfs' | 'nfc', company }`; a exibição das notas será implementada depois. A lista é conferida novamente ao reabrir o pop-up ou receber `notes:downloaded`. O som é gerado localmente via Web Audio, sem baixar arquivos de áudio.

Passar o mouse pelo ícone de empresas abre o seletor; mover o ponteiro entre ícone e pop-up o mantém aberto, e sair dessa área o fecha. O seletor também aceita foco por teclado, toque e Escape. A lista tem rolagem e uma opção fixa de cadastrar empresa. Essa opção abre uma janela independente, sem bloquear a principal. Chamá-la novamente traz a janela existente para frente. Fechar ou minimizar uma janela não fecha ou minimiza a outra.

O cadastro em `public/company-registration.html`, `.css` e `.js` usa fundo `#131214`, moldura compartilhada e redimensionamento por bordas. Campos obrigatórios: razão social, tipo/número do documento (CNPJ, CPF, CEI ou CAEPF), login e senha do portal SEFAZ. Código e inscrição estadual são opcionais. A senha fica mascarada. A validação local verifica preenchimento, formato, dígitos verificadores e duplicidade; não valida credenciais no portal nem consulta situação cadastral. Salvar cria e seleciona a empresa, atualiza o seletor principal e limpa o formulário. Os dados ficam em `companies.json`; login e senha do portal são criptografados juntos com `safeStorage` do Electron antes da gravação e nunca retornam nas listagens. O cadastro não é salvo sem proteção criptográfica disponível. A gravação é feita exclusivamente pela janela autenticada no desktop; o navegador permite visualizar o formulário.

O cadastro também permite importar opcionalmente um certificado A1 `.pfx`/`.p12` de até 5 MB e informar sua senha em campo mascarado, separado da senha do portal. O seletor nativo é exclusivo da janela autenticada de cadastro. A interface recebe apenas nome e token temporário; os bytes do arquivo permanecem no processo principal. Cancelar a seleção mantém o arquivo anterior; Remover o desvincula do formulário. Salvar verifica abertura com senha, presença de certificado/chave e datas de validade antes de gravar. O arquivo e a senha são criptografados juntos com `safeStorage` em `certificate.encryptedPayload`, dentro do cadastro da empresa em `companies.json`. Não depende do arquivo original após salvar nem expira ao fechar o aplicativo; a validade do próprio certificado continua aplicável. As listagens só incluem metadados públicos (nome, titular quando disponível, vencimento e fingerprint), nunca o PFX ou a senha.

O método interno `companyCatalog.loadCertificate(companyId, { encryption })` recupera o certificado salvo e repete a conferência de validade, para o futuro processador de buscas periódicas. Não existe rota HTTP que devolva seu conteúdo. O processador deverá limpar o buffer após uso e executar no perfil Windows que protegeu o cadastro. A seleção temporária é limpa ao remover, substituir, salvar ou fechar a janela. Essa persistência ainda não inicia consultas ou agendamentos, não valida cadeia/revogação e não confirma autorização do titular para a empresa cadastrada; essas regras pertencem ao fluxo de consulta. As consultas manuais continuam com o mecanismo de certificado em sessão já existente.

A conferência de documentos está em `public/document-validation.js`, compartilhada entre formulário e catálogo. A mensagem aparece ao sair do campo ou trocar o tipo; o salvamento repete a validação e rejeita documento inválido antes de gravar. Aceita pontuação e zeros iniciais, CNPJ numérico ou alfanumérico, e rejeita sequências repetidas e caracteres indevidos. CPF, CEI e CAEPF seguem os [algoritmos do SIB-XML publicados pela ANS](https://www.gov.br/ans/pt-br/arquivos/assuntos/espaco-da-operadora-de-plano-de-saude/aplicativos-ans/sib/sib-algoritmos-xml10-17012019.pdf); CNPJ usa o módulo 11 com valores ASCII menos 48 conforme a [Receita Federal, pergunta 14](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/cnpj/cnpj-alfanumerico.pdf). Essa validação confirma apenas a consistência matemática, sem comprovar existência, titularidade ou situação ativa. Cadastros anteriores não são alterados automaticamente.

A seleção fica centralizada em `public/company-context.js`, compartilhada por Chaves, CT-e e MDF. Sem empresa selecionada, os três botões ficam desabilitados. Selecionar uma empresa atualiza o contexto único; cada botão emite `company-module:request` com `{ module, company }`, sem iniciar consultas ou antecipar seu conteúdo. Os módulos futuros devem importar `companyContext`, em vez de manter seleções independentes. Ao concluir o cadastro, `company:registered` atualiza a lista.

O adaptador `src/companyCatalog.js` fornece as rotas autenticadas `GET /api/companies` e `POST /api/companies/selection`, persistindo a seleção em `%LOCALAPPDATA%/ConsultaDanfeAutomacao/companies.json`. O catálogo local usa `{ companies: [{ id, legalName, cnpj?, code?, documentType?, document?, stateRegistration?, portalCredentials? }], selectedCompanyId }`; identificadores são strings únicas e `portalCredentials` contém apenas o texto criptografado em base64, excluído das respostas. A criação usa o IPC `company:create` com autenticação e verificação da janela remetente. Não há importação automática de pastas de XMLs como cadastros. Se não existir catálogo, a lista começa vazia, sem empresas de demonstração.

Menu, Notas Automáticas e Notas Manuais têm uma seta de voltar no canto superior direito, antes dos controles da janela. As telas de notas retornam ao menu; o menu retorna ao login. O login não tem seta. Todas as telas ajustam o layout ao espaço disponível. Nas telas transparentes, arraste uma borda ou um canto da moldura para redimensionar; a janela de consultas mantém o redimensionamento nativo. O tamanho escolhido para cada tela é mantido durante a navegação na sessão do aplicativo. O código compartilhado dessas interações fica em `public/window-ui.js`, `public/window-ui.css` e `src/windowResize.js`.

## Modos de uso

Antes das consultas normais, o app procura arquivos `chave.xml` na pasta escolhida e
em suas subpastas, incluindo pastas antigas com nomes de empresas, como `zilma`.
A busca e feita em lote, sem varrer a pasta novamente para cada chave. XMLs completos e bem formados, com chave coerente
no documento e protocolo, data de emissao valida e vinculo com o CNPJ informado,
aparecem como **Ja disponivel**, sem consulta a SEFAZ, API ou site.
O arquivo existente e usado no local original, sem copiar ou mover. Arquivos incompletos,
renomeados com outra chave ou de outra empresa seguem para a consulta normal.
Essa verificacao vale para chaves, PDFs, planilhas e tentativas de fallback. O diagnostico
oculto continua consultando o site para coletar evidencias, mesmo quando houver XML local.
Selecione a pasta que contem os arquivos antigos, ou uma pasta acima dela, em **Onde salvar?**.

Se a pasta selecionada ja estiver dentro de uma estrutura de CNPJ, mes e entradas/saidas,
o app reconhece essa estrutura em vez de acrescentar novamente todos os niveis.
Pastas existentes sao reutilizadas, inclusive `CNPJ/mes/tipo` e `CNPJ/tipo/mes`, com CNPJ
pontuado, tipos no singular/com acentos e meses `AAAA-MM` ou `MM-AAAA`. Para outro mes ou
tipo, cria apenas a parte que falta dentro da empresa. A busca de XMLs considera tambem
os outros periodos dessa estrutura. Pastas antigas nao sao renomeadas ou movidas.

O relatorio final exibido, copiado ou baixado em TXT contem apenas os titulos **Sucessos:**
e **Falhas:**, com uma chave de 44 digitos por linha, sem marcadores ou mensagens junto
das chaves. Chaves repetidas em cada grupo aparecem uma vez. Os detalhes dos erros
continuam nos resultados da tela e nos relatorios especificos.

O fallback pelo site e oferecido para chaves validas com falha em consultas manuais,
PDFs e planilhas, inclusive quando o erro nao e `data_fora_da_janela`. Com certificado,
essa etapa e automatica apos as tentativas por NSU e API. Itens sem chave valida nao
sao reenviados; uma falha do proprio site nao inicia outra rodada de fallback.

### Diagnostico oculto do fallback

Cole as chaves no bloco de entrada e pressione **Ctrl + Shift + \*** (asterisco da
linha superior ou do teclado numerico). O atalho inicia uma rodada separada de consultas
diretas ao site em navegador headless. Nao usa o certificado nem pede classificacao de notas.
Ele so inicia quando nao ha processamento ou popup aberto; manter a tecla pressionada nao
inicia outras rodadas.

Esse modo registra as mensagens do console (incluindo argumentos), excecoes JavaScript,
requisicoes, respostas HTTP com corpos de texto e falhas de rede. Depois de cada tentativa
com erro, aguarda 1,5 segundo para mensagens adicionais e salva HTML, imagem e JSON dos
eventos. Se outra tentativa recuperar o XML, as evidencias da falha anterior permanecem.
As capturas usam os mesmos tempos e criterios de repeticao do fallback normal.

O resultado fica em `pasta escolhida/diagnosticos/identificador/relatorio.html` e
`relatorio.json`, com uma pasta por chave que apresentou falha. Ao terminar, o app baixa
um ZIP com o relatorio e as evidencias; uma copia do ZIP tambem fica na pasta `diagnosticos`.
O relatorio informa falhas de captura e truncamentos: ate 500 eventos por categoria,
2 MiB por corpo de resposta e 8 MiB de corpos por tentativa. Headers de cookies e
autorizacao sao omitidos. XMLs retornados servem para confirmar o resultado da consulta
e nao sao salvos como downloads de notas nesse modo.

O processamento normal nao instala os listeners de diagnostico nem gera essas capturas.

### App desktop

```powershell
npm.cmd run dev
```

Esse comando abre a janela nativa do app via Electron.

## Build do executavel

```powershell
npm.cmd run build:exe
```

Artefato atual:

```text
dist-electron\consulta-danfe-0.1.0.exe
```

## Fluxos suportados

### Campo manual

Cole chaves de 44 digitos ou trechos de XML no campo principal e processe direto.

### Busca com certificado digital

Ative o switch **Com certificado** abaixo do campo de chaves. O aplicativo abre um popup
para selecionar um certificado **A1** (`.pfx` ou `.p12`) e informar sua senha. A senha e o
arquivo ficam somente na memoria durante a busca e sao descartados ao terminar.

Nesse modo, a consulta usa o web service nacional `NFeDistribuicaoDFe` da SEFAZ, que confirma
o vinculo do certificado com o documento. Isso tambem preserva consultas validas de empresas
destinatarias, pois a chave de acesso contem apenas o CNPJ do emitente. Quando a SEFAZ nao
autorizar a empresa, o app informa a falha. Ele salva apenas retornos com `procNFe` (XML
completo); se a SEFAZ disponibilizar somente `resNFe` (resumo), informa o motivo sem salvar um
XML incompleto.

Para evitar o limite de consultas individuais da SEFAZ, a consulta por chave com certificado e
limitada no app. As chaves que nao retornarem XML completo seguem automaticamente para a
distribuicao `distNSU`; o cursor de NSU e o cache de XMLs completos ficam guardados localmente
por CNPJ. Cada rodada consulta no maximo tres lotes NSU (ate 150 documentos) antes de continuar,
sem aviso intermediario, pela consulta sem certificado e pelo fallback do site quando aplicavel.
Se a SEFAZ informar que nao ha novos NSUs, o app respeita a espera de uma hora antes da proxima
distribuicao. Ao usar essa cadeia, um popup permite baixar um XLSX com cada nota e a forma final
de download.

Nos resultados e no XLSX do fluxo com certificado, cada chave tambem exibe a competencia
(ano/mes codificados na chave), a data exata de emissao quando o XML foi obtido e a evidencia da
consulta SEFAZ: `consChNFe` individual ou `distNSU` em lote, envio efetuado, `cStat`, motivo e
quantidade de lotes/documentos lidos. A competencia da chave nao informa o dia de emissao; esse
dia so e conhecido quando o XML esta disponivel.

Observacao: certificados A3 em token/cartao e certificados instalados apenas no repositório do
Windows ainda nao fazem parte deste fluxo; ele requer o arquivo A1 exportado pela empresa.

### PDFs

O app:

1. le o texto do PDF;
2. extrai a chave;
3. consulta a API;
4. salva o XML retornado.

Observacao:

- PDFs escaneados como imagem podem precisar de OCR depois.

### Planilhas

O app:

1. abre a primeira aba da planilha;
2. examina a primeira linha;
3. encontra a coluna com cabecalho `Chave de Acesso`;
4. percorre as linhas seguintes;
5. consulta cada chave valida e salva o XML.

Observacao importante:

- Se o Excel tiver convertido a chave para numero ou formato cientifico, a chave pode perder precisao. Nesses casos, exporte a coluna como texto antes de processar.

## Estrutura principal

- `src/electron-main.js`: janela desktop principal.
- `src/electron-preload.js`: bridge segura entre janela e recursos nativos.
- `server.js`: API local e fila de processamento.
- `src/consultaDanfe.js`: consulta HTTP direta no Consulta DANFE.
- `src/siteFallback.js`: fallback automatico pelo site quando a API nao pode coletar a chave.
- `src/pdfToXml.js`: extracao de chaves de PDFs.
- `src/spreadsheetKeys.js`: leitura de planilhas e descoberta da coluna `Chave de Acesso`.

## Observacoes

- O executavel agora e um app desktop real, nao uma janela de navegador externo.
- A consulta principal depende da disponibilidade da API externa.
- Quando uma chave valida termina com falha, o app oferece uma tentativa pelo site; com certificado, ela ocorre automaticamente.
# Organizar XMLs ja baixados

Em **Onde salvar?**, clique em **Organizar XMLs ja baixados**. Informe a pasta e o CNPJ da empresa e clique em **Organizar e mover**. A pasta sugerida e o destino atual; voce pode alterar o caminho no formulario.

A funcao le NF-e na pasta e subpastas, incluindo pastas anuais antigas, e usa o mes de emissao para organizar em `AAAA-MM/entradas` ou `AAAA-MM/saidas`. Reutiliza pastas existentes, inclusive dentro da pasta do CNPJ e com nomes como `Saidas` ou `Sa?das`; so cria o destino quando ele nao existe. Se houver destinos ambiguos, registra a pendencia para que seja selecionada a pasta da empresa.

Arquivos com a mesma chave e conteudos diferentes sao movidos como versoes distintas, com sufixo `-versao-SHA256.xml`, preservando assinaturas e protocolos de cada versao sem substituir arquivos. Assinaturas presentes nao significam que sua validade criptografica foi verificada. Copias com conteudo identico sao indicadas no relatorio e preservadas na origem.

XMLs cujo unico problema de sintaxe seja `&` sem escape podem ser classificados por uma leitura tolerante, com alerta no relatorio. O arquivo movido mantem os bytes originais e continua sendo XML invalido; nao ocorre reparo do documento fiscal. Outros erros, datas invalidas e documentos de outro CNPJ permanecem na origem com o motivo registrado. Atalhos e a pasta `diagnosticos` sao ignorados.

O conteudo de origem e destino e conferido por SHA-256 antes de excluir a origem. O usuario do Windows precisa de leitura, gravacao e exclusao nas pastas envolvidas, sem exigencia de administrador por padrao. Erros de permissao e arquivos bloqueados aparecem no relatorio.

Teste de integracao com copias dos arquivos de um relatorio (nao altera os originais):

```powershell
node scripts/verify-xml-reorganization.js "relatorio.txt" "C:\pasta\da empresa" "00000000000000"
```

## Historico de tentativas de consulta

### Planilhas de Chaves — SEFAZ-BA

No menu, abra **Planilhas de Chaves**, escolha a empresa e o intervalo de autorização e clique em **Buscar planilhas na SEFAZ**. A coleta usa o login/senha do portal salvos no cadastro, sem certificado A1. O navegador roda oculto. Quando o portal exige CAPTCHA, informe o código da imagem na própria tela. A coleta mantém a imagem em memória enquanto aguarda a resposta.

O serviço continua ao navegar para outra tela do aplicativo. A lista é filtrada pela empresa e por planilhas com intervalo inteiro dentro das datas escolhidas. É possível conferir as chaves importadas e baixar o original. Arquivos, dados e histórico ficam em `%LOCALAPPDATA%/ConsultaDanfeAutomacao/key-collections/`; os contadores diferenciam chaves novas, duplicadas e linhas rejeitadas. Essa etapa não inicia recuperação de XMLs nem atualiza o marcador de conclusão das consultas de XML. Fechar completamente o aplicativo interrompe o trabalho; na próxima abertura o histórico o identifica como interrompido.

Implementação: `src/sefazBaPortal.js` (navegação/download headless), `src/portalSpreadsheet.js` (leitura e validação), `src/keyCollection.js` (trabalho persistente e rotas autenticadas), `public/key-sheets.*` (tela). As credenciais só são descriptografadas no processo principal/backend e não são devolvidas pelas APIs. Os eventos não persistem senhas, cookies ou imagens de CAPTCHA.

Validação de 19/11/2026: **92 testes passaram**, incluindo downloads reais de um servidor de teste com Chromium headless. O piloto da MER CALCADOS em 18/11/2026 conseguiu ler as credenciais protegidas, mas a navegação real parou antes do login por recusa do certificado HTTPS no ambiente. Nenhuma planilha real da empresa foi importada. Evidências e próximos passos em `EXPANSAO/VALIDACAO_COLETA_SEFAZ_2026-11-19.md`.

### Escolha automatica da origem

No fluxo sem certificado, o servidor verifica primeiro os XMLs locais e classifica internamente as chaves restantes pelo ano/mes informado na chave. O grupo elegivel para a API e o grupo destinado ao site iniciam independentemente, na mesma rodada. Esse agrupamento nao exige escolha do usuario.

A API recebe notas do mes corrente e, ate o dia 14, do mes anterior, considerando o calendario de Brasilia. As demais seguem diretamente ao site, inclusive para tentar documentos antigos eventualmente disponiveis em cache; a recuperacao destes nao e garantida. Chaves com periodo futuro, periodo invalido ou modelo diferente de NF-e 55 nao geram consultas externas.

Falhas reais elegiveis da API sao encaminhadas automaticamente ao site na mesma rodada, mantendo o erro inicial e o historico. O processamento do site usa uma origem por vez; a fila de recuperacao da API e atendida apos o grupo direto do site. Limites HTTP 429, pausas do fornecedor, notas pendentes HTTP 202 e erros de entrada nao sao encaminhados dessa forma.

A fila compartilhada da API nesta instancia inicia no maximo uma chamada a cada 1,1 segundo, incluindo repeticoes. Respeita Retry-After sem reduzir o prazo a tres segundos. Pausas maiores que um minuto sao registradas sem deixar toda a operacao aguardando horas; novas chamadas externas nessa fila ficam impedidas enquanto a pausa durar. Outros programas que compartilham o IP tambem podem consumir a cota do fornecedor.

Os JSONL registram a decisao em routing (origem, periodo, motivo e fuso). Encaminhamento direto por periodo nao e registrado como uma falha da API que nao aconteceu. O fluxo com certificado continua usando seus processadores especificos.

Cada lote grava eventos em `relatorios-consultas` dentro da pasta escolhida para os XMLs. Os arquivos `.jsonl` registram horario, duracao, etapa, tentativa, codigo HTTP e motivo do erro. A consulta pela API e a consulta pelo site geram registros separados; ao concluir a rodada, um registro final reune o resultado e o historico do fallback por chave, inclusive o erro inicial das notas recuperadas. O caminho do historico final aparece junto ao relatorio da tela e permanece salvo ao reabrir o aplicativo. O TXT com listas de chaves continua disponivel.

XMLs, senhas e certificados nao sao incluidos nos logs. As chaves das notas e mensagens de erro sao registradas para permitir a conferencia. Falhas ao salvar o relatorio final aparecem na tela.

Validacao real da tela, API e fallback com a amostra de 12 chaves distribuida pelo arquivo, salvando XMLs e logs em uma pasta temporaria isolada do projeto:

```powershell
node scripts/validate-lookup-flow.js "C:\caminho\chaves.txt"
```

## Matriz e filiais nas consultas

Ao informar o CNPJ da empresa, o aplicativo reconhece estabelecimentos da mesma base de oito dígitos e classifica cada XML pelo CNPJ completo de emitente e destinatário. Salva em `CNPJ/AAAA-MM/entradas` ou `CNPJ/AAAA-MM/saidas`, reutilizando as pastas existentes. XMLs idênticos reutilizam o arquivo; conteúdos diferentes da mesma chave recebem sufixo SHA-256, sem substituir a versão existente. Quando os dois lados são estabelecimentos da empresa, a classificação prioriza a saída do emitente.

Com certificado, o titular permanece o mesmo e o CNPJ interessado da requisição pode ser outro estabelecimento da mesma base. O lote identifica emitentes próprios pelas chaves; destinatários de entradas só podem ser confirmados pelo XML. Estabelecimentos aprendidos ficam disponíveis durante a sessão do certificado. Na ausência de documento, são considerados os estabelecimentos conhecidos, respeitando o limite global das consultas pontuais. O fallback NSU mantém cursor e cache por CNPJ completo. A descoberta não enumera filiais que não aparecem nas chaves ou XMLs do lote; as regras de disponibilidade e autorização da SEFAZ continuam aplicáveis.

Falhas locais de organização não provocam novas consultas em outros serviços. O relatório registra o CNPJ interessado, o estabelecimento identificado e a resposta técnica disponível, preservando erros anteriores.

### Direcionamento de lotes com certificado

Notas de emiss?o pr?pria seguem diretamente para a busca sem certificado; elas n?o consomem consultas pontuais nem entram no NSU do emitente. As entradas de lotes com mais de 20 chaves seguem primeiro pela distribui??o NSU. As duas origens s?o iniciadas independentemente. Para lotes pequenos, o limite de consultas pontuais ? persistido entre execu??es, conservadoramente compartilhado pela base de CNPJ; um retorno 656 imp?e pausa de uma hora nas novas consultas pontuais.

A varredura NSU de lotes grandes permite at? 100 lotes por estabelecimento, com or?amento de 90 segundos por estabelecimento. O cursor ? salvo a cada lote. Se a varredura for interrompida antes do m?ximo, a pend?ncia ? registrada como `nsu_varredura_parcial`, sem afirmar que a nota n?o existe. Ao alcan?ar o final da distribui??o, a pr?xima consulta aguarda uma hora. Essa origem continua sujeita ? disponibilidade e manifesta??o; ampliar a varredura n?o garante o XML completo de toda chave.
