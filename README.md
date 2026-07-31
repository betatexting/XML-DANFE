# Consulta DANFE

Aplicacao local simples para:

- colar chaves de acesso ou trechos de XML;
- enviar PDFs da DANFE;
- consultar no site `https://consultadanfe.com`;
- baixar os XMLs usando Playwright.

## Estrutura

- `public/`: interface web simples.
- `server.js`: servidor Express e endpoint de processamento.
- `src/consultaDanfe.js`: fluxo da automacao Playwright.
- `src/pdfToXml.js`: extracao de chave a partir de PDFs.
- `src/accessKeys.js`: utilitario de extracao de chaves.
- `src/selectors.js`: arquivo para preencher com os selectors do site.
- `C:\Users\Contas Contabilidade\Desktop\werasmim`: destino padrao dos arquivos baixados.

## Como rodar

1. Instale as dependencias:

```powershell
$env:npm_config_cache="C:\xml danfe\.npm-cache"
npm.cmd install
```

2. Instale o navegador do Playwright:

```powershell
npm.cmd run playwright:install
```

3. Preencha os selectors em `src/selectors.js`.

4. Inicie o servidor:

```powershell
npm.cmd start
```

5. Acesse `http://localhost:3000`.

## Pasta de download

Por padrao, os XMLs sao salvos em:

```text
C:\Users\Contas Contabilidade\Desktop\werasmim
```

Se quiser trocar depois, rode o servidor com a variavel `DOWNLOADS_DIR`.

## Conversao de PDF para XML

O sistema faz a conversao de PDF para XML desta forma:

1. le o texto do PDF da DANFE;
2. extrai a chave de acesso de 44 digitos;
3. consulta essa chave no `consultadanfe.com`;
4. baixa o XML correspondente para a pasta `downloads/`.

Limitacao atual:

- PDFs escaneados apenas como imagem podem nao trazer texto suficiente para localizar a chave. Nesses casos, sera preciso adicionar OCR depois.

## Proximo passo

Assim que os selectors forem definidos, a automacao ja consegue:

- abrir o site;
- preencher a chave;
- submeter a consulta;
- aguardar o ponto certo da tela;
- clicar para baixar;
- salvar cada arquivo com o nome da propria chave.
