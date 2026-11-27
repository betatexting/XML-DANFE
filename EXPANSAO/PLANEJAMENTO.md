# Planejamento da expansão do Consulta DANFE

Data de consolidação: 12/11/2026.

Este documento reúne o que foi discutido sobre a expansão do projeto. É documentação para execução futura: não representa autorização para implementar telas, autenticação, integrações ou automações neste momento. A análise técnica se refere à estrutura examinada durante a conversa; os arquivos deverão ser conferidos novamente antes da implementação.

## Atualização de 18/11/2026 — login e menu autorizados

Foi implementada a tela inicial de login conforme o print fornecido, com autenticação local, primeiro cadastro no aplicativo, validação de senha, sessão e bloqueio de páginas/APIs e seletores nativos até autenticação. A opção salvar preenche login e senha, criptografados com a proteção do Windows, sem entrada automática. Após entrar, é apresentado o menu conforme o segundo print fornecido. Notas Manuais abre a consulta existente; Notas Automáticas abre a base visual autorizada no print seguinte, ainda sem componentes internos. Planilhas de Chaves permanece desabilitado. As integrações e automações continuam previstas para etapas futuras.

Detalhes de uso e limites estão na seção Acesso local do README. Esta atualização substitui, apenas para as etapas de login local e navegação do menu, as indicações abaixo de que toda a expansão ainda não foi implementada.

## 1. Objetivo e limites atuais

Atualização de 19/11/2026: primeira versão de Planilhas de Chaves implementada com serviço headless, download/importação e filtros por empresa/período. Testes locais passaram; o piloto real da MER CALCADOS parou antes do login por erro HTTPS no ambiente. OCR e agendamentos ainda não estão implementados. Ver `VALIDACAO_COLETA_SEFAZ_2026-11-19.md` para evidências e limites desta entrega.

Transformar o aplicativo em um sistema com acesso por login, menu de funcionalidades, cadastro de empresas e acompanhamento de buscas automáticas, mantendo a consulta manual existente.

Diretrizes expressas pelo usuário:

- A página atual de consultas manuais deve ser preservada com seus recursos.
- Essa página deixará de ser a primeira opção apresentada ao abrir o sistema.
- O sistema passará a exigir login.
- Após o login, haverá outra tela com botões para acessar as funcionalidades.
- As telas de login, menu e demais áreas já foram preparadas pelo usuário em um canvas. Não criar ou redesenhar essas telas durante o planejamento.
- Avaliar o encaixe na arquitetura existente, evitando quebras e redundâncias.
- Por enquanto, apenas documentar para continuidade futura.

O canvas e seus arquivos não foram inspecionados nesta análise. Não presumir tecnologia, estrutura ou disponibilidade desses layouts no repositório.

## 2. Navegação pretendida

Fluxo inicial previsto: abertura do aplicativo → login → menu preparado pelo usuário.

O menu dará acesso a:

| Área | Finalidade |
| --- | --- |
| Consultas manuais | Acessar a página atual e inserir chaves manualmente, preservando também os recursos existentes de PDFs, planilhas, certificado e fallback. |
| Buscas automáticas | Verificar o status das buscas cadastradas e cadastrar mais empresas para busca automática. |
| Busca de planilhas | Verificar as buscas cadastradas e cadastrar novos acessos, com login e senha, para coleta de planilhas. |

A definição visual pertence às telas existentes. As regras de execução devem permanecer fora da apresentação.

## 3. Ideia de integração com a SEFAZ-BA

O usuário informou que o portal permite extrair planilhas de chaves mediante login e senha das empresas, que poderão ficar cadastrados no sistema.

Endereço fornecido:

<https://nfe.sefaz.ba.gov.br/servicos/NFENC/SSL/ASLibrary/Login?ReturnUrl=%2fservicos%2fnfenc%2fModulos%2fAutenticado%2fRestrito%2fNFENC_consulta_destinatario.aspx>

O destino indicado no endereço é a consulta de destinatário. Não considerar a consulta de emitidas como parte confirmada do escopo sem definição posterior.

A tentativa de acesso feita na análise não obteve resposta do portal. Não houve autenticação, download de amostra ou validação do fluxo atual. Documentação oficial antiga descreve consultas restritas mediante senha, mas não comprova os detalhes atuais da exportação nem a viabilidade de execução sem intervenção humana.

Referência consultada: [manual da SEFAZ-BA](https://www.sefaz.ba.gov.br/docs/inspetoria-eletronica/icms/nfe_manual_contribuinte.pdf).

### Validações necessárias

- Forma atual de autenticação e campos exigidos.
- Existência de CAPTCHA, confirmação adicional ou outra etapa interativa.
- Como confirmar a empresa efetivamente autenticada.
- Possibilidade de um acesso representar mais de uma empresa e como selecionar a empresa, caso aplicável.
- Filtros de período, limites por consulta e paginação.
- Disponibilidade de recebidas e, se desejado, emitidas.
- Formato real do arquivo exportado, abas, cabeçalhos e representação textual das chaves.
- Como distinguir consulta sem resultados de erro na consulta ou exportação.
- Duração de sessão e comportamento em sessão expirada, senha incorreta e indisponibilidade.
- Condições operacionais e limites do portal relevantes à automação.

Uma etapa que exija intervenção deverá gerar estado apropriado e permitir retomada. A execução integralmente automática permanece condicionada à validação do portal.

## 4. Estrutura existente e pontos de reaproveitamento

O projeto examinado é um aplicativo desktop Windows baseado em Electron, com Express local, interface em `public/` e módulos de consulta em `src/`. Já há `playwright-core` para automação de navegador e `xlsx` para planilhas.

| Arquivo ou módulo | Responsabilidade observada | Papel na expansão |
| --- | --- | --- |
| `src/electron-main.js` | Janela, recursos nativos, inicialização e encerramento do servidor local. | Integrar o novo fluxo de entrada e os recursos nativos necessários. |
| `src/electron-preload.js` | Ponte entre interface e recursos nativos. | Expor apenas operações necessárias à interface. |
| `server.js` | Rotas locais, configuração de pasta e processamento de lotes com eventos NDJSON. | Rotas como adaptadores para serviços compartilhados. |
| `public/app.js` | Interface manual e parte da coordenação de tentativas e combinação de resultados. | Preservar a consulta manual e reduzir dependência das regras de execução em relação à tela. |
| `src/accessKeys.js` | Extração de chaves e informações derivadas delas. | Reutilizar a extração e validação comuns. |
| `src/spreadsheetKeys.js` | Leitura de CSV, XLSX, XLSM e XLS. | Reaproveitar a leitura para as exportações do portal. |
| `src/pdfToXml.js` | Extração de candidatos de PDFs. | Preservar o fluxo atual. |
| `src/localXml.js` | Busca em lote de XMLs locais e verificação de elegibilidade. | Evitar consultas externas quando já houver XML válido. |
| `src/consultaDanfe.js` | Consulta HTTP direta e processamento de chaves. | Continuar como mecanismo de recuperação de XML. |
| `src/siteFallback.js` | Consulta automatizada pelo site e inicialização de navegador. | Manter o fallback; avaliar compartilhamento apenas de infraestrutura genérica de navegador. |
| `src/nfeDistribution.js` | Consulta com certificado e distribuição NSU. | Reutilizar no processamento conforme a política definida. |
| `src/nfeDistributionState.js` | Cursores, intervalo de próxima consulta e cache por CNPJ. | Manter estado único e coordenado da distribuição por empresa. |
| `src/certificate.js` e `src/certificateSession.js` | Identificação e sessão temporária de certificado. | Preservar o comportamento atual; persistência futura exige decisão própria. |
| `src/xmlStorage.js` | Classificação e gravação de XMLs por empresa, período e tipo. | Único caminho de organização para os diversos modos. |
| `src/storageDirectories.js` | Resolução e reaproveitamento das estruturas de diretórios. | Evitar criar novas convenções de pasta para automações. |
| `src/runtimePaths.js` | Resolução do diretório local de dados. | Considerar na persistência de configurações e estado. |
| `src/browserDiagnostics.js` | Diagnóstico específico de navegador. | Preservar e avaliar tratamento de segredos antes de qualquer reaproveitamento em sessão autenticada. |

### Comportamentos atuais a preservar

- Entrada manual de chaves, extração de PDFs e importação de planilhas.
- Consulta HTTP como mecanismo principal no modo sem certificado e fallback pelo site para falhas elegíveis.
- Consulta com certificado A1, tentativas por chave e distribuição NSU, com continuidade por API e site no fluxo atual.
- Busca prévia de XMLs existentes em lote, inclusive em estruturas antigas, reutilizando o arquivo no local original.
- Validação do XML e do vínculo com a empresa antes de tratá-lo como disponível.
- Organização em `CNPJ/AAAA-MM/entradas ou saidas/chave.xml`, com reaproveitamento de estruturas reconhecidas e sem mover arquivos antigos.
- Classificação pela empresa, emitente e destinatário; uso da emissão do XML e das regras existentes para competência.
- Resultados, evidências e relatórios já disponíveis.
- Regras atuais de elegibilidade e de não repetir indefinidamente o fallback.

O README e os testes existentes devem ser usados para revisar os detalhes desses contratos antes de refatorar.

### Limitação atual do leitor de planilhas

`src/spreadsheetKeys.js` procura o cabeçalho normalizado `Chave de Acesso` na primeira linha da primeira aba. A exportação da Bahia precisa ser comparada a essa expectativa. Caso haja diferenças, adaptar o formato da origem sem duplicar toda a extração. Chaves com 44 dígitos devem continuar sendo tratadas como texto, evitando perda de precisão numérica.

## 5. Principal ajuste arquitetural

Hoje a coordenação está dividida entre backend e interface:

- `processCandidateBatch`, em `server.js`, agrupa candidatos, verifica XMLs locais e executa um processador, mas recebe `res` e escreve diretamente na resposta HTTP.
- `public/app.js` coordena parte da cadeia certificado → NSU → API → site, combina resultados e solicita confirmação de fallback quando aplicável.

A busca automática precisa executar sem depender de uma tela aberta conduzindo etapas ou de uma conexão HTTP permanecer ativa.

### Proposta

Extrair um serviço de processamento compartilhado, independente de DOM, diálogos e resposta HTTP, com entradas explícitas:

- Empresa e contexto de classificação.
- Chaves ou candidatos com metadados de origem.
- Pasta de destino da execução.
- Política de consulta, fallback e tentativas.
- Referências às credenciais ou sessão de certificado necessárias.
- Identificador da execução e callbacks ou eventos de progresso e resultado.

As rotas manuais adaptam seus pedidos e eventos para esse serviço. O executor automático chama o mesmo serviço. A interface continua responsável por apresentação e decisões interativas do usuário; a política automática expressa previamente as decisões necessárias à execução sem interação.

Migrar gradualmente, preservando contratos e comportamento manual. Não criar uma segunda cadeia de download exclusiva da automação.

## 6. Separação das duas automações

### Coleta de planilhas

Responsável por autenticar no portal, consultar o período, exportar a planilha, identificar erros e entregar candidatos com proveniência. Não deve incorporar regras próprias de download e gravação de XML.

A coleta também deve abranger chaves de NFC-e (modelo 65). Validar primeiro, com acesso autorizado, a origem da relação de NFC-e emitidas por empresa e período na SEFAZ-BA, o formato da exportação e o campo de data utilizado. O leitor de planilhas já aceita o modelo 65 quando informado explicitamente. A coleta atual usa o modelo 55. Ao integrar a nova origem, registrar o modelo no histórico e manter os filtros por empresa e período.

### Busca automática de XMLs

Responsável por processar as chaves disponíveis conforme a política da empresa, reutilizando verificação local, mecanismos de consulta e armazenamento existentes.

### Encadeamento proposto

Agendamento → empresa → coleta no portal → extração e deduplicação → processamento compartilhado → histórico e pendências.

As etapas devem ter resultados distinguíveis e poder ser acompanhadas separadamente. Proposta a confirmar: permitir que uma coleta alimente automaticamente a busca de XMLs ou seja executada somente para obtenção de chaves/planilha.

Exemplo: uma exportação com cem chaves e dez falhas de download representa coleta concluída e recuperação parcial de XMLs. Uma nova tentativa pode atuar nas dez pendências, sem repetir obrigatoriamente a exportação.

Ainda falta definir a fonte das buscas automáticas que não forem alimentadas pelo portal, e se haverá descoberta de documentos por certificado sem uma lista prévia de chaves. Não presumir que o uso atual de NSU como tentativa para chaves conhecidas já atende a uma rotina autônoma de descoberta.

## 7. Cadastro e modelo de dados proposto

Certificado A1 no cadastro: importação opcional de `.pfx`/`.p12` e senha própria, com verificação local de abertura e validade. Arquivo e senha são persistidos criptografados com a proteção do Windows e recuperáveis pelo catálogo para o futuro processador. Essa etapa não implementa agendamentos, integração com portais ou validação de autorização do titular para a empresa.

Etapa implementada: cadastro local em janela independente, aberto pelo seletor de empresas, com código e inscrição estadual opcionais; razão social, tipo/número do documento (CNPJ/CPF/CEI/CAEPF) e credenciais do portal SEFAZ obrigatórios. O cadastro seleciona a nova empresa e atualiza a janela principal. Login e senha do portal são criptografados com a proteção do Windows e não são expostos nas listagens. O acesso ao portal e a validação das credenciais permanecem pendentes da definição do fluxo pelo usuário.

Entidades conceituais, sujeitas à definição do modo de implantação:

| Entidade | Conteúdo e responsabilidade |
| --- | --- |
| Usuário | Identidade de acesso, credencial de autenticação e permissões. |
| Sessão | Estado de autenticação, validade e revogação. |
| Empresa | CNPJ, nome, UF e configurações comuns, incluindo destino quando aplicável. |
| Integração da empresa | Serviço ou portal, identificação do acesso e referência à credencial protegida. |
| Credencial | Segredo protegido e metadados necessários à sua manutenção. |
| Automação | Empresa, fonte, frequência, período, habilitação e política de processamento. |
| Execução | Origem manual ou agendada, empresa, configuração utilizada, datas, etapa, estado e resumo. |
| Item da execução | Chave, proveniência, tentativas, resultado, erro e referência ao XML. |

Uma empresa terá um cadastro único, podendo ter várias integrações e automações. Evitar cadastros separados da mesma empresa em cada tela. Converter o cadastro para o contexto `organization` já utilizado pelo processamento.

Separar a identidade do documento no contexto da empresa da ocorrência da chave em uma execução. Isso permite deduplicar por empresa e chave e, ao mesmo tempo, conservar a proveniência e o histórico de reprocessamentos.

Manter os XMLs nas pastas existentes. O banco guarda referências e estado; não criar outro repositório permanente de XMLs sem necessidade demonstrada. O cache NSU atual continua tendo sua finalidade específica.

Para operação local, SQLite foi proposto como opção para registros relacionados, histórico e retomada, sem servidor de banco separado. Não é uma decisão fechada. Se houver uso compartilhado entre computadores, reavaliar backend central, banco e armazenamento.

## 8. Login, permissões e credenciais

O login do aplicativo é independente do login da SEFAZ e da senha de certificado.

### Decisões pendentes de autenticação

- Uso local em uma instalação ou usuários em computadores diferentes.
- Dados e empresas compartilhados ou separados por usuário/equipe.
- Quem cria usuários, cadastra empresas e altera integrações ou credenciais.
- Recuperação de acesso, expiração de sessão e logout.
- Comportamento de execuções em andamento após logout.
- Eventual acesso offline, conforme o modelo de autenticação escolhido.

### Implementação futura

- Proteger as operações no backend, não apenas a navegação das telas.
- Revisar também as operações expostas pela ponte nativa e o acesso a relatórios/arquivos.
- Armazenar verificadores de senha do sistema com derivação apropriada, caso a autenticação seja própria.
- Proteger de forma reversível os segredos externos que precisam ser apresentados ao portal.
- Não devolver senhas existentes nas respostas de cadastro nem registrá-las em logs, relatórios ou eventos da interface.
- Separar dados cadastrais de segredos, vinculando-os por referência.
- Prever substituição de credenciais e estados que indiquem necessidade de intervenção.

Foi sugerido avaliar `safeStorage` no processo principal do Electron, que utiliza proteção do sistema operacional e, no Windows, DPAPI. Conferir a API compatível com a versão efetivamente usada no projeto antes de implementar.

Referência: <https://www.electronjs.org/docs/latest/api/safe-storage>.

Considerar as implicações de proteção vinculada ao usuário/máquina para backup, restauração e transporte do executável. Não tratar dados sensíveis como arquivos temporários descartáveis: revisar os caminhos alternativos de `runtimePaths.js` antes de usá-los para persistência durável de credenciais e histórico.

Cookies e sessões do portal também são sensíveis. Isolar contextos de navegador entre empresas/acessos; a política de persistência de sessões ainda precisa ser definida. Qualquer diagnóstico de sessão autenticada deve evitar capturar segredos em formulários, HTML, imagens ou corpos de requisição.

No fluxo atual, arquivo A1 e senha são temporários e permanecem em memória durante a busca. Guardar certificado e senha para uma automação futura é uma mudança de requisito separada, ainda não definida. A3 e certificados disponíveis apenas no repositório Windows não fazem parte do fluxo atual documentado.

## 9. Concorrência, agendamento e retomada

### Configuração por execução

`downloadsDir` é atualmente uma variável global no servidor. O novo serviço deve receber a pasta explicitamente e conservar a configuração da execução, evitando que uma alteração na interface afete trabalho já iniciado.

### Concorrência

- Proposta inicial: uma execução automática por vez, reduzindo complexidade operacional.
- Coordenar também consultas manuais e automáticas que acessem a mesma empresa.
- Proteger o estado NSU por empresa contra leituras e gravações concorrentes.
- Respeitar os intervalos e controles de distribuição já existentes.
- Evitar duplicar trabalhos agendados, sessões incompatíveis e consultas repetidas da mesma chave.

Serializar somente a fila automática não resolve, por si só, conflitos com consultas manuais.

### Política de agendamento a definir

- Frequência e horário, com fuso explícito.
- Data inicial e forma de carga do histórico.
- Janela de revisão de períodos recentes para capturar documentos disponibilizados depois.
- Tratamento de horários perdidos com computador ou aplicativo desligado.
- Limites de tentativa, intervalos de espera e diferenciação entre falha transitória e credencial inválida.
- Pausar, reativar, cancelar e executar novamente, conforme o escopo das telas existentes.
- Retomada após encerramento inesperado sem repetir trabalho concluído desnecessariamente.

Não marcar um período como coletado com sucesso se houve falha parcial de paginação ou exportação. Separar o avanço da coleta das pendências de download de XML.

### Aplicativo aberto ou segundo plano

Hoje o fechamento do aplicativo encerra o servidor. A opção inicial sugerida foi executar agendamentos enquanto o aplicativo estiver aberto. Executar com a janela/aplicativo fechado exige decidir entre processo residente, integração com Agendador do Windows ou outra implantação. Essa decisão não foi tomada.

## 10. Histórico e acompanhamento

Persistir progresso e resultados para que as telas consultem o estado sem serem responsáveis por manter o trabalho em execução. A desconexão de uma tela de acompanhamento não deve, por acidente, definir o ciclo de vida da automação.

Estados candidatos, a ajustar ao escopo e às telas: aguardando, em execução, concluída, concluída com pendências, falhou, aguardando intervenção, cancelada e interrompida. Diferenciar estado da automação cadastrada, da execução, da coleta e de cada chave.

Registrar, quando aplicável:

- Empresa, automação, identificador da execução e período solicitado.
- Início, término, etapa atual e próxima tentativa.
- Origem da chave, arquivo, aba e linha quando disponíveis.
- Quantidades de chaves encontradas, únicas, disponíveis localmente, recuperadas e pendentes.
- Mecanismo final de recuperação e histórico de tentativas.
- Motivo de falha e evidências já suportadas pelo fluxo SEFAZ.
- Caminho do XML ou da planilha, se o arquivo for conservado.

Definir retenção de histórico, logs, planilhas e diagnósticos e sua política de backup. A guarda permanente da planilha original ainda não foi decidida.

## 11. Organização de responsabilidades sugerida

Os nomes finais de arquivos e diretórios serão definidos na implementação. A separação desejada é:

- Apresentação: telas existentes, navegação e exibição de resultados.
- Adaptadores de entrada: rotas HTTP e operações nativas necessárias.
- Autenticação e autorização: sessão e permissão das operações.
- Cadastros: empresas, integrações e configurações de automação.
- Cofre de credenciais: proteção e recuperação de segredos apenas para quem executa a integração.
- Coletor SEFAZ-BA: autenticação, consulta, exportação e adaptação do formato.
- Processamento compartilhado: candidatos, verificação local, políticas de consulta e combinação de resultados.
- Executor e agendador: fila, bloqueios, tentativas e retomada.
- Persistência: configurações, execuções, itens e referências a arquivos.
- Módulos existentes de recuperação e armazenamento: reaproveitados com mudanças pontuais quando necessárias.

Não ampliar `siteFallback.js` para concentrar o portal da Bahia inteiro. Os sites têm objetivos e contratos diferentes. Compartilhar somente infraestrutura genérica que seja útil e estável, sem acoplar seletores e regras de autenticação entre integrações.

## 12. Ordem proposta para implementação futura

1. Revalidar o estado do repositório e os contratos atuais; localizar e analisar as telas preparadas pelo usuário.
2. Fechar decisões de implantação, usuários, permissões, automações e funcionamento em segundo plano.
3. Validar o portal com acesso autorizado e obter uma exportação real.
4. Definir contratos dos serviços, modelo persistente e política de credenciais.
5. Extrair gradualmente o processamento compartilhado e preservar as rotas e comportamentos manuais.
6. Adicionar persistência, autenticação, autorização e cadastro único de empresas e integrações.
7. Implementar execuções, histórico, bloqueios, fila, agendamento e retomada.
8. Implementar o coletor SEFAZ-BA e conectá-lo à extração e ao processamento existentes.
9. Conectar as telas prontas ao login, menu, cadastros e acompanhamento; a ligação básica do login pode acompanhar a etapa de autenticação.
10. Validar regressões, cenários completos e empacotamento desktop.

Essas etapas são planejamento, não início de implementação. A validação do portal e as definições de implantação podem alterar detalhes e prioridades.

## 13. Critérios de validação futura

- Login seguido do menu, com consulta manual acessível e funcional.
- Rotas e operações nativas sensíveis sujeitas à autenticação/autorização adequada.
- Consultas manuais por chaves, PDFs e planilhas preservadas.
- Cadeias com certificado e sem certificado mantendo suas políticas e relatórios.
- XML local elegível evitando consulta externa; XML inválido seguindo o fluxo normal.
- Empresa, contexto de navegador, credencial, pasta e resultados sem mistura entre execuções.
- Vínculo do XML à empresa verificado antes da gravação.
- Planilha BA interpretada corretamente, sem perda de precisão das chaves.
- Coleta vazia legítima distinta de exportação incompleta ou falha.
- Sessão expirada, credencial inválida, intervenção necessária e indisponibilidade com estados claros.
- Tentativas limitadas e retomada sem repetição indevida de itens concluídos.
- Estado NSU e gravações coordenados entre trabalho manual e automático.
- Alteração da pasta padrão sem mudar a pasta de execução já iniciada.
- Histórico consultável após reabertura e comportamento definido após interrupção.
- Ausência de segredos em respostas, logs, relatórios e diagnósticos.
- Comportamento de backup/restauração e proteção de credenciais verificado no modo de implantação escolhido.

Usar os testes existentes como base para regressão. Acrescentar verificações de contratos e de cenários novos conforme a implementação, sem duplicar testes que apenas espelhem detalhes internos.

## 14. Registro de decisões e pendências

### Confirmado pelo usuário

- Preservar a página atual de consultas manuais.
- Torná-la uma opção após o login e o novo menu.
- Exigir login no sistema.
- Ter áreas de acompanhamento e cadastro para buscas automáticas e coleta de planilhas.
- Usar as telas já preparadas pelo usuário.
- Documentar agora, sem implementar.

### Recomendações técnicas ainda não implementadas

- Tratar o portal BA como fonte de chaves.
- Núcleo de processamento único para consultas manuais e automáticas.
- Cadastro único de empresas com integrações e automações relacionadas.
- Separação de coleta e recuperação de XML, com possibilidade de encadeamento.
- Persistência de histórico e retomada; considerar SQLite para operação local.
- Cofre de credenciais com proteção do sistema operacional no cenário desktop local.
- Configuração explícita e estável por execução.
- Começar com execução automática serializada e bloqueios compartilhados por empresa.

### Pendências que afetam o desenho final

- Implantação local ou centralizada e compartilhamento entre computadores.
- Política de usuários, permissões, recuperação de acesso e sessões.
- Fonte e alcance da busca automática de XMLs fora da coleta BA.
- Consulta de recebidas apenas ou também emitidas.
- Política de certificado persistente, se necessário.
- Validação real do portal e exportação.
- Frequência, períodos, revisão, limites de tentativa e retomada.
- Execução com aplicativo fechado.
- Retenção de arquivos e histórico, backup e restauração.
- Localização e estrutura técnica das telas existentes.

## 15. Orientação para retomada

Ao retomar, ler este documento e conferir novamente o código antes de implementar. Não assumir que recomendações foram aprovadas como decisões finais nem que o portal foi validado. Preservar alterações existentes no repositório e manter o escopo definido pelo usuário.

Princípio orientador: consultas manuais e automáticas compartilham as regras de processamento; variam a origem dos dados, a política de execução e a forma de iniciar e acompanhar o trabalho.
