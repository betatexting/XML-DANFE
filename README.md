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
