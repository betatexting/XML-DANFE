const form = document.querySelector("#process-form");
const rawKeysField = document.querySelector("#rawKeys");
const submitButton = document.querySelector("#submitButton");
const certificateMode = document.querySelector("#certificateMode");
const certificateModeHelp = document.querySelector("#certificateModeHelp");
const certificateSelectionSummary = document.querySelector("#certificateSelectionSummary");
const certificateDialog = document.querySelector("#certificateDialog");
const certificateForm = document.querySelector("#certificateForm");
const certificateFileInput = document.querySelector("#certificateFileInput");
const selectCertificateButton = document.querySelector("#selectCertificateButton");
const certificateFileName = document.querySelector("#certificateFileName");
const certificatePassword = document.querySelector("#certificatePassword");
const certificateAuthorUf = document.querySelector("#certificateAuthorUf");
const certificateDialogMessage = document.querySelector("#certificateDialogMessage");
const certificateCancelButton = document.querySelector("#certificateCancelButton");
const certificateConfirmButton = document.querySelector("#certificateConfirmButton");
const certificateReportDialog = document.querySelector("#certificateReportDialog");
const certificateReportDialogCopy = document.querySelector("#certificateReportDialogCopy");
const certificateReportDialogSummary = document.querySelector("#certificateReportDialogSummary");
const closeCertificateReportButton = document.querySelector("#closeCertificateReportButton");
const downloadCertificateReportButton = document.querySelector("#downloadCertificateReportButton");
const pdfFilesField = document.querySelector("#pdfFiles");
const pdfSubmitButton = document.querySelector("#pdfSubmitButton");
const pdfTopicStatus = document.querySelector("#pdfTopicStatus");
const spreadsheetFilesField = document.querySelector("#spreadsheetFiles");
const spreadsheetSubmitButton = document.querySelector("#spreadsheetSubmitButton");
const spreadsheetTopicStatus = document.querySelector("#spreadsheetTopicStatus");
const summary = document.querySelector("#summary");
const resultsList = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");
const emptyTitle = document.querySelector("#emptyTitle");
const emptyCopy = document.querySelector("#emptyCopy");
const pdfFileSummary = document.querySelector("#pdfFileSummary");
const spreadsheetFileSummary = document.querySelector("#spreadsheetFileSummary");
const downloadsDirField = document.querySelector("#downloadsDir");
const lookupModeSummary = document.querySelector("#lookupModeSummary");
const lookupPerformanceSummary = document.querySelector("#lookupPerformanceSummary");
const reportMeta = document.querySelector("#reportMeta");
const reportOutput = document.querySelector("#reportOutput");
const copyReportButton = document.querySelector("#copyReportButton");
const downloadReportButton = document.querySelector("#downloadReportButton");
const windowMinimizeButton = document.querySelector("#windowMinimizeButton");
const windowMaximizeButton = document.querySelector("#windowMaximizeButton");
const windowCloseButton = document.querySelector("#windowCloseButton");
const fallbackDialog = document.querySelector("#fallbackDialog");
const fallbackDialogList = document.querySelector("#fallbackDialogList");
const fallbackDialogCopy = document.querySelector("#fallbackDialogCopy");
const REPORT_STORAGE_KEY = "consultaDanfe:lastReport";
const LOOKUP_MODE_LABELS = {
  "local-file": "Arquivo local",
  "http-direct": "API direta",
  "site-fallback": "Fallback do site",
  "nfe-distribution-certificate": "SEFAZ com certificado",
  "nfe-distribution-nsu": "SEFAZ por NSU"
};
const DOWNLOAD_METHOD_LABELS = {
  "local-file": "Ja disponivel na pasta",
  "certificate-key": "Baixada com certificado — consulta por chave",
  "certificate-nsu": "Baixada com certificado — distribuicao NSU",
  "certificate-nsu-cache": "Baixada com certificado — cache NSU",
  "without-certificate-api": "Baixada sem certificado",
  "without-certificate-site": "Baixada sem certificado"
};
const UF_CODES_BY_NAME = {
  AC: "12",
  AL: "27",
  AM: "13",
  AP: "16",
  BA: "29",
  CE: "23",
  DF: "53",
  ES: "32",
  GO: "52",
  MA: "21",
  MG: "31",
  MS: "50",
  MT: "51",
  PA: "15",
  PB: "25",
  PE: "26",
  PI: "22",
  PR: "41",
  RJ: "33",
  RN: "24",
  RO: "11",
  RR: "14",
  RS: "43",
  SC: "42",
  SE: "28",
  SP: "35",
  TO: "17",
  ACRE: "12",
  ALAGOAS: "27",
  AMAZONAS: "13",
  AMAPA: "16",
  BAHIA: "29",
  CEARA: "23",
  "DISTRITO FEDERAL": "53",
  "ESPIRITO SANTO": "32",
  GOIAS: "52",
  MARANHAO: "21",
  "MATO GROSSO": "51",
  "MATO GROSSO DO SUL": "50",
  "MINAS GERAIS": "31",
  PARA: "15",
  PARAIBA: "25",
  PARANA: "41",
  PERNAMBUCO: "26",
  PIAUI: "22",
  "RIO DE JANEIRO": "33",
  "RIO GRANDE DO NORTE": "24",
  "RIO GRANDE DO SUL": "43",
  RONDONIA: "11",
  RORAIMA: "14",
  "SANTA CATARINA": "42",
  "SAO PAULO": "35",
  SERGIPE: "28",
  TOCANTINS: "17"
};
const desktopApi = window.consultaDanfeDesktop ?? null;
let currentReportText = "";
let currentReportFileName = "";
let certificateDraft = null;
let certificateState = null;
let currentCertificateReportRows = [];

document.body.classList.add(desktopApi?.isDesktop ? "is-desktop-shell" : "is-web-shell");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setEmptyState(title, copy) {
  emptyTitle.textContent = title;
  emptyCopy.textContent = copy;
}

function showEmptyState() {
  emptyState.classList.remove("is-hidden");
  resultsList.hidden = true;
}

function hideEmptyState() {
  emptyState.classList.add("is-hidden");
  resultsList.hidden = false;
}

function clearResults(
  title = "Aguardando consulta",
  copy = "Os resultados aparecem aqui com status, chave localizada e nome do XML gerado."
) {
  resultsList.innerHTML = "";
  setEmptyState(title, copy);
  showEmptyState();
}

function setControlsDisabled(disabled) {
  submitButton.disabled = disabled;
  if (certificateMode) {
    certificateMode.disabled = disabled;
  }
  pdfSubmitButton.disabled = disabled || pdfFilesField.files.length === 0;
  spreadsheetSubmitButton.disabled = disabled || spreadsheetFilesField.files.length === 0;
}

function normalizeUfName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function inferAuthorUfCode(stateName) {
  return UF_CODES_BY_NAME[normalizeUfName(stateName)] || "";
}

function setCertificateDialogMessage(message = "", { success = false } = {}) {
  if (!certificateDialogMessage) {
    return;
  }

  certificateDialogMessage.textContent = message;
  certificateDialogMessage.classList.toggle("is-success", success);
}

function updateCertificateFileName() {
  if (!certificateFileName) {
    return;
  }

  certificateFileName.textContent = certificateDraft?.fileName || "Nenhum certificado selecionado.";
}

function updateCertificateModeCopy() {
  if (!certificateModeHelp || !certificateSelectionSummary) {
    return;
  }

  if (!certificateMode?.checked) {
    certificateModeHelp.textContent =
      "Sem certificado, a consulta usa a API atual e pode retornar documentos incompletos.";
    certificateSelectionSummary.textContent = "";
    return;
  }

  certificateModeHelp.textContent =
    "Com certificado, o CNPJ dele identifica a empresa. A data e a classificacao de entradas e saidas sao lidas automaticamente no XML.";

  if (!certificateState) {
    certificateSelectionSummary.textContent = "Selecione e confirme um certificado para continuar.";
    return;
  }

  const owner = certificateState.commonName ? ` — ${certificateState.commonName}` : "";
  certificateSelectionSummary.textContent =
    `${certificateState.fileName} | CNPJ ${certificateState.formattedCnpj}${owner}.`;
}

async function discardSelectedCertificate() {
  const certificateId = certificateState?.certificateId || certificateDraft?.certificateId;
  certificateState = null;
  certificateDraft = null;

  if (certificateFileInput) {
    certificateFileInput.value = "";
  }

  updateCertificateFileName();

  if (!certificateId) {
    return;
  }

  try {
    await fetch("/api/certificate/discard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ certificateId })
    });
  } catch (_error) {
    // A sessao tambem expira automaticamente no servidor.
  }
}

function openCertificateDialog() {
  if (!certificateDialog || typeof certificateDialog.showModal !== "function") {
    return Promise.resolve(false);
  }

  certificateDialog.returnValue = "";
  certificatePassword.value = "";
  certificateAuthorUf.value = certificateState?.authorUfCode || "";
  certificateDraft = certificateState
    ? {
        certificateId: certificateState.certificateId,
        fileName: certificateState.fileName
      }
    : null;
  updateCertificateFileName();
  setCertificateDialogMessage("");

  return new Promise((resolve) => {
    certificateDialog.addEventListener(
      "close",
      () => {
        resolve(certificateDialog.returnValue === "confirm");
      },
      { once: true }
    );
    certificateDialog.showModal();
  });
}

function getCertificatePayload() {
  if (!certificateMode?.checked) {
    return null;
  }

  if (!certificateState) {
    throw new Error("Selecione e confirme um certificado digital para buscar neste modo.");
  }

  return {
    certificateId: certificateState.certificateId,
    certificatePassphrase: certificateState.passphrase,
    certificateAuthorUf: certificateState.authorUfCode
  };
}

async function inspectCertificateDraft() {
  if (!certificateDraft) {
    throw new Error("Selecione um certificado A1 em formato .pfx ou .p12.");
  }

  const passphrase = certificatePassword.value;
  let authorUfCode = certificateAuthorUf.value;

  let response;
  if (certificateDraft.file) {
    const formData = new FormData();
    formData.append("certificate", certificateDraft.file);
    formData.append("certificatePassphrase", passphrase);
    response = await fetch("/api/certificate/inspect", {
      method: "POST",
      body: formData
    });
  } else {
    response = await fetch("/api/certificate/inspect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        certificateId: certificateDraft.certificateId,
        certificatePassphrase: passphrase
      })
    });
  }

  const data = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(data.error || "Nao foi possivel validar o certificado.");
  }

  if (!authorUfCode) {
    authorUfCode = inferAuthorUfCode(data.state);
    if (authorUfCode) {
      certificateAuthorUf.value = authorUfCode;
    }
  }

  if (!authorUfCode) {
    certificateDraft = {
      certificateId: data.certificateId,
      fileName: data.fileName
    };
    updateCertificateFileName();
    throw new Error("Selecione a UF da empresa vinculada ao certificado.");
  }

  const previousCertificateId = certificateState?.certificateId;
  certificateState = {
    certificateId: data.certificateId,
    fileName: data.fileName,
    formattedCnpj: data.formattedCnpj || data.cnpj,
    commonName: data.commonName || "",
    authorUfCode,
    passphrase
  };
  certificateDraft = {
    certificateId: data.certificateId,
    fileName: data.fileName
  };

  if (certificateFileInput) {
    certificateFileInput.value = "";
  }

  if (previousCertificateId && previousCertificateId !== data.certificateId) {
    fetch("/api/certificate/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ certificateId: previousCertificateId })
    }).catch(() => {});
  }

  updateCertificateFileName();
  return certificateState;
}

function formatSelectedFilesSummary(files, { emptyLabel, singularLabel, pluralLabel }) {
  if (files.length === 0) {
    return emptyLabel;
  }

  if (files.length === 1) {
    return `${singularLabel}: ${files[0].name}`;
  }

  const preview = files
    .slice(0, 2)
    .map((file) => file.name)
    .join(", ");
  const suffix = files.length > 2 ? ` +${files.length - 2}` : "";

  return `${files.length} ${pluralLabel}: ${preview}${suffix}`;
}

function updatePdfFileSummary() {
  const files = [...pdfFilesField.files];

  if (pdfFileSummary) {
    pdfFileSummary.textContent = formatSelectedFilesSummary(files, {
      emptyLabel: "Nenhum PDF selecionado.",
      singularLabel: "PDF",
      pluralLabel: "PDFs"
    });
  }

  if (pdfTopicStatus) {
    pdfTopicStatus.textContent = String(files.length);
  }

  pdfSubmitButton.disabled = submitButton.disabled || files.length === 0;
}

function updateSpreadsheetFileSummary() {
  const files = [...spreadsheetFilesField.files];

  if (spreadsheetFileSummary) {
    spreadsheetFileSummary.textContent = formatSelectedFilesSummary(files, {
      emptyLabel: "Nenhuma planilha selecionada.",
      singularLabel: "Planilha",
      pluralLabel: "planilhas"
    });
  }

  if (spreadsheetTopicStatus) {
    spreadsheetTopicStatus.textContent = String(files.length);
  }

  spreadsheetSubmitButton.disabled = submitButton.disabled || files.length === 0;
}

function formatLookupMode(value) {
  return LOOKUP_MODE_LABELS[value] || value || "Motor nao informado";
}

function formatIssueMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]} (competencia da chave)` : "";
}

function formatDocumentIssueDate(value) {
  return String(value || "").replace("T", " ");
}

function formatSefazQueryType(value) {
  if (value === "consChNFe") {
    return "consChNFe (individual)";
  }

  if (value === "distNSU") {
    return "distNSU (lote)";
  }

  return value || "Consulta SEFAZ";
}

function formatSefazEvidence(sefaz) {
  if (!sefaz || typeof sefaz !== "object") {
    return "";
  }

  const parts = [formatSefazQueryType(sefaz.queryType)];
  parts.push(sefaz.submitted ? "enviada" : "nao enviada");

  if (sefaz.cStat) {
    parts.push(`cStat ${sefaz.cStat}`);
  }

  if (sefaz.httpStatus) {
    parts.push(`HTTP ${sefaz.httpStatus}`);
  }

  if (sefaz.batches) {
    parts.push(`${sefaz.batches} lote(s)`);
  }

  if (Number.isFinite(sefaz.documentsRead)) {
    parts.push(`${sefaz.documentsRead} documento(s) lido(s)`);
  }

  if (Number.isFinite(sefaz.requestedKeys)) {
    parts.push(`${sefaz.requestedKeys} chave(s) pendente(s)`);
  }

  if (sefaz.documentFound === true) {
    parts.push("nota localizada no lote");
  }

  if (sefaz.documentFound === false) {
    parts.push("nota nao localizada nos lotes consultados");
  }

  if (sefaz.batchLimitReached) {
    parts.push("limite da rodada atingido");
  }

  if (sefaz.forwardedTo) {
    parts.push(`encaminhada para ${sefaz.forwardedTo}`);
  }

  return parts.filter(Boolean).join(" | ");
}

function getSefazTraces(result) {
  return [result?.sefaz, ...(result?.fallbackHistory || []).map((item) => item?.sefaz)].filter(
    (trace) => trace && typeof trace === "object"
  );
}

function getSefazEvidenceForResult(result) {
  return [...new Set(getSefazTraces(result).map(formatSefazEvidence).filter(Boolean))].join(" -> ");
}

function getSefazReasonsForResult(result) {
  return [...new Set(getSefazTraces(result).map((trace) => trace.xMotivo).filter(Boolean))].join(" -> ");
}

function createResultMarkup(result) {
  const badgeClass = result.status === "success" ? "success" : "error";
  const badgeText = result.alreadyAvailable ? "Ja disponivel" : result.status === "success" ? "Baixado" : "Falhou";
  const title = result.key || result.sourceName || "Resultado";
  const itemClass = result.status === "success" ? "is-success" : "is-error";
  const details = [];

  if (result.sourceName) {
    details.push({
      label: result.sourceType === "planilha" ? "Planilha" : "PDF",
      value: result.sourceName
    });
  }

  if (result.sheetName) {
    details.push({
      label: "Aba",
      value: result.sheetName
    });
  }

  if (result.rowNumber) {
    details.push({
      label: "Linha",
      value: String(result.rowNumber)
    });
  }

  if (result.key) {
    details.push({
      label: "Chave",
      value: result.key
    });
  }

  if (result.issueMonth) {
    details.push({
      label: "Competencia",
      value: formatIssueMonth(result.issueMonth)
    });
  }

  if (result.documentIssueDate) {
    details.push({
      label: "Emissao no XML",
      value: formatDocumentIssueDate(result.documentIssueDate)
    });
  }

  if (result.lookupMode) {
    details.push({
      label: "Motor",
      value: formatLookupMode(result.lookupMode)
    });
  }

  if (result.downloadMethod) {
    details.push({
      label: "Forma",
      value: DOWNLOAD_METHOD_LABELS[result.downloadMethod] || result.downloadMethod
    });
  }

  const sefazEvidence = getSefazEvidenceForResult(result);
  const sefazReasons = getSefazReasonsForResult(result);
  if (sefazEvidence) {
    details.push({
      label: "Consulta SEFAZ",
      value: sefazEvidence
    });

    if (sefazReasons) {
      details.push({
        label: "Retorno SEFAZ",
        value: sefazReasons
      });
    }
  }

  if (result.attemptCount) {
    details.push({
      label: "Tentativas",
      value: String(result.attemptCount)
    });
  }

  if (result.status === "success") {
    details.push({
      label: "Arquivo",
      value: result.fileName
    });
    if (result.alreadyAvailable && result.filePath) {
      details.push({ label: "Local", value: result.filePath });
    }
  } else {
    if (result.errorCode) {
      details.push({
        label: "Codigo",
        value: result.errorCode
      });
    }

    details.push({
      label: "Mensagem",
      value: result.message || "Erro desconhecido"
    });
  }

  return `
    <li class="result-item ${itemClass}">
      <div class="result-top">
        <strong class="result-title">${escapeHtml(title)}</strong>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="result-meta">
        ${details
          .map(
            (detail) => `
              <div class="meta-row">
                <span class="meta-label">${escapeHtml(detail.label)}</span>
                <span class="meta-value">${escapeHtml(detail.value)}</span>
              </div>
            `
          )
          .join("")}
      </div>
    </li>
  `;
}

function appendResult(result) {
  hideEmptyState();
  resultsList.insertAdjacentHTML("beforeend", createResultMarkup(result));
}

function renderResults(results) {
  if (results.length === 0) {
    clearResults();
    return;
  }

  resultsList.innerHTML = "";
  for (const result of results) {
    appendResult(result);
  }
}

function getResultCounts(results) {
  const successCount = results.filter((item) => item.status === "success").length;
  const errorCount = results.length - successCount;

  return {
    successCount,
    errorCount
  };
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatFileTimestamp(value) {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildReportFileName(label, finishedAt) {
  const normalizedLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `relatorio-${normalizedLabel || "consulta"}-${formatFileTimestamp(finishedAt)}.txt`;
}

function buildFinalReport({ label, results, startedAt, finishedAt }) {
  const { successCount, errorCount } = getResultCounts(results);
  const keysForStatus = (success) => [...new Set(results
    .filter((item) => (item.status === "success") === success && /^\d{44}$/.test(item.key || ""))
    .map((item) => item.key))];
  const lines = ["Sucessos:", "", ...keysForStatus(true), "", "Falhas:", "", ...keysForStatus(false)];
  return {
    label,
    startedAt,
    finishedAt,
    summaryText: `${successCount} ok / ${errorCount} falhas / ${results.length} total.`,
    fileName: buildReportFileName(label, finishedAt),
    text: `${lines.join("\n")}\n`
  };
}

function setReportButtonsDisabled(disabled) {
  if (copyReportButton) {
    copyReportButton.disabled = disabled;
  }

  if (downloadReportButton) {
    downloadReportButton.disabled = disabled;
  }
}

function renderReport(report) {
  if (!reportOutput || !reportMeta) {
    return;
  }

  currentReportText = report?.text || "";
  currentReportFileName = report?.fileName || "";

  if (!currentReportText) {
    reportMeta.textContent =
      "O fechamento da ultima rodada fica salvo aqui, mesmo quando a fila da tela reinicia.";
    reportOutput.textContent = "Nenhum relatorio final disponivel ainda.";
    setReportButtonsDisabled(true);
    return;
  }

  reportMeta.textContent = `${report.label} finalizado em ${formatDateTime(report.finishedAt)}. ${report.summaryText}`;
  reportOutput.textContent = currentReportText;
  setReportButtonsDisabled(false);
}

function saveReport(report) {
  renderReport(report);

  try {
    window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(report));
  } catch (_error) {
    // Se o navegador bloquear armazenamento local, o relatorio continua visivel na sessao atual.
  }
}

function loadSavedReport() {
  try {
    const raw = window.localStorage.getItem(REPORT_STORAGE_KEY);

    if (!raw) {
      renderReport(null);
      return;
    }

    const report = JSON.parse(raw);
    renderReport(report);
  } catch (_error) {
    renderReport(null);
  }
}

function buildResultIdentity(result) {
  return [
    result.key || "",
    result.sourceType || "",
    result.sourceName || "",
    result.sheetName || "",
    result.rowNumber || ""
  ].join("::");
}

function getFallbackEligibleResults(results) {
  return results.filter(
    (result) =>
      result?.status === "error" &&
      result?.lookupMode !== "site-fallback" &&
      typeof result?.key === "string" &&
      /^\d{44}$/.test(result.key)
  );
}

function getFailedKeyResults(results) {
  return results.filter(
    (result) =>
      result?.status === "error" && typeof result?.key === "string" && result.key.trim().length > 0
  );
}

function getFallbackHistoryEntry(result) {
  return {
    status: result.status,
    errorCode: result.errorCode || "",
    message: result.message || "",
    lookupMode: result.lookupMode || "",
    downloadMethod: result.downloadMethod || "",
    issueMonth: result.issueMonth || "",
    documentIssueDate: result.documentIssueDate || "",
    sefaz: result.sefaz || null
  };
}

function mergeSingleFallbackResult(baseResult, fallbackResult) {
  const history = [...(baseResult.fallbackHistory || []), getFallbackHistoryEntry(baseResult)];

  return {
    ...fallbackResult,
    fallbackHistory: history
  };
}

function mergeFallbackResults(baseResults, fallbackResults) {
  const fallbackByIdentity = new Map(
    fallbackResults.map((result) => [buildResultIdentity(result), result])
  );

  return baseResults.map((result) => {
    const fallbackResult = fallbackByIdentity.get(buildResultIdentity(result));
    return fallbackResult ? mergeSingleFallbackResult(result, fallbackResult) : result;
  });
}

function renderFallbackDialogItems(results) {
  const uniqueKeys = [...new Set(results.map((result) => result.key).filter(Boolean))];

  if (fallbackDialogCopy) {
    fallbackDialogCopy.textContent =
      uniqueKeys.length === 1
        ? "A chave abaixo terminou com falha. Deseja tentar novamente pelo site?"
        : `As ${uniqueKeys.length} chaves abaixo terminaram com falha. Deseja tentar novamente pelo site?`;
  }

  if (fallbackDialogList) {
    fallbackDialogList.innerHTML = uniqueKeys
      .map((key) => `<div class="fallback-dialog__item">${escapeHtml(key)}</div>`)
      .join("");
  }

  return uniqueKeys;
}

function buildFallbackConfirmMessage(results) {
  const uniqueKeys = renderFallbackDialogItems(results);

  return [
    `${uniqueKeys.length} chave(s) terminaram com falha.`,
    "",
    ...uniqueKeys,
    "",
    "Deseja tentar agora pelo fallback automatico do site?"
  ].join("\n");
}

function openFallbackDialog(results) {
  if (!fallbackDialog || typeof fallbackDialog.showModal !== "function") {
    return Promise.resolve(window.confirm(buildFallbackConfirmMessage(results)));
  }

  renderFallbackDialogItems(results);
  fallbackDialog.returnValue = "";

  return new Promise((resolve) => {
    const handleClose = () => {
      resolve(fallbackDialog.returnValue === "confirm");
    };

    fallbackDialog.addEventListener("close", handleClose, {
      once: true
    });
    fallbackDialog.showModal();
  });
}

function renderSummary(results, label) {
  const { successCount, errorCount } = getResultCounts(results);
  summary.textContent = `${label}: ${successCount} ok / ${errorCount} falhas / ${results.length} total.`;
}

function renderProgressSummary(results, label, total) {
  const { successCount, errorCount } = getResultCounts(results);
  const completed = results.length;

  if (total > 0) {
    summary.textContent = `${label}: ${successCount} ok / ${errorCount} falhas / ${completed} de ${total} concluidos.`;
    return;
  }

  summary.textContent = `${label}: ${successCount} ok / ${errorCount} falhas / ${completed} concluidos.`;
}

function renderLookupProgress(results, label, total, progress) {
  if (progress?.type === "local-scan") {
    summary.textContent = "Verificando XMLs ja disponiveis na pasta escolhida e em suas subpastas...";
    return;
  }
  const { successCount, errorCount } = getResultCounts(results);
  const completed = results.length;
  const totalLabel = total > 0 ? `${completed} de ${total}` : `${completed}`;
  const keyLabel = progress?.key ? ` Chave ${progress.key}.` : "";
  const attempt =
    progress?.attempt && progress?.maxAttempts
      ? ` Tentativa ${progress.attempt}/${progress.maxAttempts}.`
      : "";

  if (progress?.type === "retry-wait") {
    const waitSeconds = Math.max(1, Math.round((progress.retryDelayMs || 0) / 1000));
    summary.textContent =
      `${label}: ${successCount} ok / ${errorCount} falhas / ${totalLabel} concluidos.` +
      `${keyLabel}${attempt} Nova tentativa em ${waitSeconds}s.`;
    return;
  }

  if (progress?.type === "nsu-sync") {
    const batchLabel = progress.batch ? ` Lote NSU ${progress.batch}.` : "";
    summary.textContent =
      `${label}: ${successCount} ok / ${errorCount} falhas / ${totalLabel} concluidos.` + batchLabel;
    return;
  }

  summary.textContent =
    `${label}: ${successCount} ok / ${errorCount} falhas / ${totalLabel} concluidos.` +
    `${keyLabel}${attempt}`;
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

async function consumeResultStream(response, label) {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/x-ndjson")) {
    const data = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(data.error || "Falha ao iniciar o processamento.");
    }

    const results = Array.isArray(data.results) ? data.results : [];
    renderResults(results);
    renderSummary(results, label);

    return {
      results,
      failedMessage: ""
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Nao foi possivel receber as atualizacoes em tempo real.");
  }

  const state = {
    total: 0,
    results: [],
    failedMessage: "",
    isComplete: false
  };
  const decoder = new TextDecoder();
  let buffer = "";

  function handlePayload(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (payload.type === "start") {
      state.total = Number.isFinite(payload.total) ? payload.total : state.total;
      renderProgressSummary(state.results, label, state.total);
      return;
    }

    if (payload.type === "result" && payload.result) {
      state.total = Number.isFinite(payload.total) ? payload.total : state.total;
      state.results.push(payload.result);
      appendResult(payload.result);
      renderProgressSummary(state.results, label, state.total);
      return;
    }

    if (payload.type === "progress" && payload.progress) {
      state.total = Number.isFinite(payload.total) ? payload.total : state.total;
      renderLookupProgress(state.results, label, state.total, payload.progress);
      return;
    }

    if (payload.type === "complete") {
      state.total = Number.isFinite(payload.total) ? payload.total : state.total;
      state.isComplete = true;
      if (payload.diagnosticReport) state.diagnosticReport = payload.diagnosticReport;
      renderSummary(state.results, label);
      return;
    }

    if (payload.type === "error") {
      state.failedMessage = payload.error || "Falha ao processar a consulta.";
    }
  }

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      handlePayload(JSON.parse(line));
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    handlePayload(JSON.parse(buffer));
  }

  if (state.failedMessage) {
    if (state.results.length > 0) {
      const total = state.total || state.results.length;
      summary.textContent = `${label}: interrompido apos ${state.results.length} de ${total}. ${state.failedMessage}`;
    } else {
      summary.textContent = state.failedMessage;
    }
  } else if (!state.isComplete) {
    renderSummary(state.results, label);
  }

  return state;
}

async function requestAutomaticFallback(items, label) {
  const response = await fetch("/api/process-fallback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      organization: activeOrganization
    })
  });

  if (!response.ok) {
    const data = await readJsonSafely(response);
    throw new Error(data.error || "Falha ao executar o fallback automatico.");
  }

  return consumeResultStream(response, `${label} | fallback do site`);
}

async function requestNsuFallback(items, certificatePayload, label) {
  const response = await fetch("/api/process-distnsu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      organization: activeOrganization,
      ...certificatePayload
    })
  });

  if (!response.ok) {
    const data = await readJsonSafely(response);
    throw new Error(data.error || "Falha ao consultar a distribuicao NSU.");
  }

  return consumeResultStream(response, `${label} | distribuicao NSU`);
}

async function requestWithoutCertificate(items, label) {
  const response = await fetch("/api/process-items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items, organization: activeOrganization })
  });

  if (!response.ok) {
    const data = await readJsonSafely(response);
    throw new Error(data.error || "Falha ao consultar as chaves sem certificado.");
  }

  return consumeResultStream(response, `${label} | sem certificado`);
}

async function maybeRunSiteFallback({ state, label, automatic = false }) {
  const fallbackItems = getFallbackEligibleResults(state.results);

  if (fallbackItems.length === 0) {
    return state;
  }

  const shouldRunFallback = automatic || (await openFallbackDialog(fallbackItems));

  if (!shouldRunFallback) {
    return state;
  }

  const baseResults = [...state.results];
  summary.textContent = `Executando fallback automatico pelo site para ${fallbackItems.length} chave(s)...`;
  clearResults(
    "Executando fallback...",
    "As chaves que terminaram com falha estao sendo consultadas novamente pelo site automatizado."
  );

  try {
    const fallbackState = await requestAutomaticFallback(fallbackItems, label);
    const mergedResults = mergeFallbackResults(baseResults, fallbackState.results);
    renderResults(mergedResults);

    if (fallbackState.failedMessage) {
      summary.textContent = `${label}: fallback com alerta. ${fallbackState.failedMessage}`;
    } else {
      renderSummary(mergedResults, label);
    }

    return {
      ...state,
      results: mergedResults,
      failedMessage: fallbackState.failedMessage || state.failedMessage
    };
  } catch (error) {
    renderResults(baseResults);
    summary.textContent =
      error.message || "Nao foi possivel executar o fallback automatico pelo site.";

    return {
      ...state,
      failedMessage: error.message || state.failedMessage
    };
  }
}

async function runCertificateFallbackChain({ state, label, certificatePayload }) {
  let mergedResults = [...state.results];
  let failedMessage = state.failedMessage || "";
  let failedItems = getFailedKeyResults(mergedResults);

  if (failedItems.length > 0) {
    summary.textContent = `Consultando distribuicao NSU para ${failedItems.length} chave(s)...`;
    clearResults(
      "Distribuicao NSU...",
      "As chaves sem XML completo na consulta pontual estao sendo procuradas no lote da SEFAZ."
    );

    try {
      const nsuState = await requestNsuFallback(failedItems, certificatePayload, label);
      mergedResults = mergeFallbackResults(mergedResults, nsuState.results);
      failedMessage = nsuState.failedMessage || failedMessage;
    } catch (error) {
      failedMessage = error.message || failedMessage;
    }
  }

  failedItems = getFailedKeyResults(mergedResults);
  if (failedItems.length > 0) {
    summary.textContent = `Consultando sem certificado ${failedItems.length} chave(s)...`;
    clearResults(
      "Fallback sem certificado...",
      "As chaves ainda sem XML completo estao sendo consultadas pela API convencional."
    );

    try {
      const withoutCertificateState = await requestWithoutCertificate(failedItems, label);
      mergedResults = mergeFallbackResults(mergedResults, withoutCertificateState.results);
      failedMessage = withoutCertificateState.failedMessage || failedMessage;
    } catch (error) {
      failedMessage = error.message || failedMessage;
    }
  }

  const withoutCertificateState = await maybeRunSiteFallback({
    state: {
      ...state,
      results: mergedResults,
      failedMessage
    },
    label,
    automatic: true
  });
  mergedResults = withoutCertificateState.results;
  failedMessage = withoutCertificateState.failedMessage || failedMessage;
  renderResults(mergedResults);
  renderSummary(mergedResults, label);

  return {
    ...state,
    results: mergedResults,
    failedMessage
  };
}

function isIncompleteResult(result) {
  return [result, ...(result?.fallbackHistory || [])].some(
    (item) => item?.errorCode === "documento_resumido"
  );
}

function getCertificateReportMethod(result) {
  if (result?.status === "success") {
    if (result.lookupMode === "nfe-distribution-certificate") {
      return "Baixada com certificado — consulta por chave";
    }

    if (result.lookupMode === "nfe-distribution-nsu") {
      return result.downloadMethod === "certificate-nsu-cache"
        ? "Baixada com certificado — cache NSU"
        : "Baixada com certificado — distribuicao NSU";
    }

    if (result.lookupMode === "http-direct" || result.lookupMode === "site-fallback") {
      return "Baixada sem certificado";
    }

    return DOWNLOAD_METHOD_LABELS[result.downloadMethod] || "Baixada com certificado";
  }

  if (isIncompleteResult(result)) {
    return "Baixada incompleta";
  }

  return "Nao baixada";
}

function getCertificateReportCategory(result) {
  if (result?.status === "success") {
    if (result.alreadyAvailable) return "local";
    if (
      result.lookupMode === "nfe-distribution-certificate" ||
      result.lookupMode === "nfe-distribution-nsu"
    ) {
      return "certificate";
    }

    if (result.lookupMode === "http-direct" || result.lookupMode === "site-fallback") {
      return "without-certificate";
    }

    return String(result.downloadMethod || "").startsWith("without-certificate")
      ? "without-certificate"
      : "certificate";
  }

  return isIncompleteResult(result) ? "incomplete" : "not-downloaded";
}

function shouldShowCertificateFallbackReport(results) {
  return results.some(
    (result) =>
      (Array.isArray(result?.fallbackHistory) && result.fallbackHistory.length > 0) ||
      ["certificate-nsu", "certificate-nsu-cache", "without-certificate-api", "without-certificate-site"].includes(
        result?.downloadMethod
      )
  );
}

function openCertificateReportDialog(results) {
  currentCertificateReportRows = results.map((result) => ({
    key: result.key || result.sourceName || "Item sem chave",
    downloadMethod: getCertificateReportMethod(result),
    category: getCertificateReportCategory(result),
    issueMonth: formatIssueMonth(result.issueMonth),
    documentIssueDate: formatDocumentIssueDate(result.documentIssueDate),
    sefazQuery: getSefazEvidenceForResult(result),
    sefazReason: getSefazReasonsForResult(result)
  }));

  const totals = currentCertificateReportRows.reduce(
    (summaryByCategory, row) => {
      summaryByCategory[row.category] = (summaryByCategory[row.category] || 0) + 1;
      return summaryByCategory;
    },
    {
      local: 0,
      certificate: 0,
      incomplete: 0,
      "without-certificate": 0,
      "not-downloaded": 0
    }
  );

  if (certificateReportDialogCopy) {
    certificateReportDialogCopy.textContent =
      "A consulta terminou. O XLSX relaciona cada nota e a forma final de download.";
  }

  if (certificateReportDialogSummary) {
    const summaryLabels = {
      local: "Ja disponiveis na pasta",
      certificate: "Baixadas com certificado",
      incomplete: "Baixadas incompletas",
      "without-certificate": "Baixadas sem certificado",
      "not-downloaded": "Nao baixadas"
    };
    certificateReportDialogSummary.innerHTML = Object.entries(summaryLabels)
      .map(
        ([category, label]) =>
          `<div class="certificate-report-dialog__item"><span>${escapeHtml(label)}</span><strong>${totals[category]}</strong></div>`
      )
      .join("");
  }

  if (certificateReportDialog && typeof certificateReportDialog.showModal === "function") {
    certificateReportDialog.showModal();
  }
}

async function finalizeCompletedRound({
  state,
  label,
  reportLabel,
  startedAt,
  certificatePayload = null
}) {
  const fallbackState = certificatePayload
    ? await runCertificateFallbackChain({
        state,
        label,
        certificatePayload
      })
    : await maybeRunSiteFallback({
        state,
        label
      });
  const { errorCount } = getResultCounts(fallbackState.results);
  const finalState =
    fallbackState.results.length > 0 && errorCount === 0
      ? {
          ...fallbackState,
          failedMessage: ""
        }
      : fallbackState;

  saveReport(
    buildFinalReport({
      label: reportLabel,
      results: finalState.results,
      failedMessage: finalState.failedMessage,
      startedAt,
      finishedAt: Date.now()
    })
  );

  if (certificatePayload && shouldShowCertificateFallbackReport(finalState.results)) {
    openCertificateReportDialog(finalState.results);
  }

  return finalState;
}

function setDownloadsDirDisplay(value) {
  if (!downloadsDirField) {
    return;
  }

  downloadsDirField.textContent = value;
  downloadsDirField.title = value;
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao foi possivel carregar a configuracao.");
    }

    setDownloadsDirDisplay(data.downloadsDir);

    if (lookupModeSummary) {
      lookupModeSummary.textContent =
        data.lookupMode === "http-direct"
          ? "As consultas vao direto para a API do Consulta DANFE. Se a chave sair da janela, o app pode oferecer fallback oculto pelo site."
          : "Motor de consulta carregado.";
    }

    if (lookupPerformanceSummary) {
      const concurrency = Number.isFinite(data.concurrency) ? data.concurrency : 1;
      const concurrencyCopy =
        concurrency > 1
          ? `Fila paralela ativa com ${concurrency} consultas simultaneas por lote.`
          : "Fila simples ativa com uma consulta por vez.";
      const fallbackCopy =
        data.fallbackMode === "site-automation"
          ? " O fallback do site fica disponivel apenas quando a API rejeita por janela de coleta."
          : "";

      lookupPerformanceSummary.textContent = `${concurrencyCopy}${fallbackCopy}`;
    }
  } catch (_error) {
    setDownloadsDirDisplay("Destino indisponivel no momento.");

    if (lookupModeSummary) {
      lookupModeSummary.textContent = "Motor de consulta indisponivel no momento.";
    }

    if (lookupPerformanceSummary) {
      lookupPerformanceSummary.textContent = "Nao foi possivel carregar o status do motor.";
    }
  }
}

async function saveDownloadsDir(nextDownloadsDir) {
  const response = await fetch("/api/downloads-dir", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      downloadsDir: nextDownloadsDir
    })
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Nao foi possivel atualizar a pasta.");
  }

  return data.downloadsDir;
}

async function selectDownloadsDir() {
  if (!downloadsDirField || downloadsDirField.classList.contains("is-loading")) {
    return;
  }

  const previousLabel = downloadsDirField.textContent;
  downloadsDirField.classList.add("is-loading");
  downloadsDirField.setAttribute("aria-busy", "true");
  setDownloadsDirDisplay("Selecionando pasta...");

  try {
    if (desktopApi?.isDesktop) {
      const selection = await desktopApi.selectDownloadsDir();

      if (selection?.canceled) {
        setDownloadsDirDisplay(previousLabel);
        summary.textContent = "Selecao de pasta cancelada.";
        return;
      }

      const updatedDownloadsDir = await saveDownloadsDir(selection.filePath);
      setDownloadsDirDisplay(updatedDownloadsDir || previousLabel);
      summary.textContent = "Pasta de salvamento atualizada.";
      return;
    }

    const response = await fetch("/api/select-downloads-dir", {
      method: "POST"
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao foi possivel selecionar a pasta.");
    }

    setDownloadsDirDisplay(data.downloadsDir || previousLabel);

    if (data.canceled) {
      summary.textContent = "Selecao de pasta cancelada.";
      return;
    }

    summary.textContent = "Pasta de salvamento atualizada.";
  } catch (error) {
    setDownloadsDirDisplay(previousLabel);
    summary.textContent = error.message || "Erro ao selecionar a pasta.";
  } finally {
    downloadsDirField.classList.remove("is-loading");
    downloadsDirField.removeAttribute("aria-busy");
  }
}

async function copyCurrentReport() {
  if (!currentReportText) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentReportText);
      summary.textContent = "Relatorio copiado.";
      return;
    }
  } catch (_error) {
    // Cai no fallback abaixo.
  }

  const helper = document.createElement("textarea");
  helper.value = currentReportText;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.top = "0";
  helper.style.left = "-9999px";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();

  try {
    document.execCommand("copy");
    summary.textContent = "Relatorio copiado.";
  } catch (_error) {
    summary.textContent = "Nao foi possivel copiar o relatorio.";
  } finally {
    helper.remove();
  }
}

function downloadCurrentReport() {
  if (!currentReportText) {
    return;
  }

  const blob = new Blob([currentReportText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = currentReportFileName || "relatorio-consulta.txt";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  summary.textContent = "Relatorio preparado para download.";
}

async function downloadCertificateReportXlsx() {
  if (currentCertificateReportRows.length === 0) {
    return;
  }

  downloadCertificateReportButton.disabled = true;

  try {
    const response = await fetch("/api/certificate-fallback-report.xlsx", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ rows: currentCertificateReportRows })
    });

    if (!response.ok) {
      const data = await readJsonSafely(response);
      throw new Error(data.error || "Nao foi possivel gerar o relatorio XLSX.");
    }

    const disposition = response.headers.get("content-disposition") || "";
    const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "relatorio-consulta-certificado.xlsx";
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    summary.textContent = "Relatorio XLSX preparado para download.";
  } catch (error) {
    summary.textContent = error.message || "Nao foi possivel gerar o relatorio XLSX.";
  } finally {
    downloadCertificateReportButton.disabled = false;
  }
}

function updateWindowState(state = {}) {
  if (!windowMaximizeButton) {
    return;
  }

  const isMaximized = Boolean(state.isMaximized);
  windowMaximizeButton.textContent = isMaximized ? "o" : "[]";
  windowMaximizeButton.setAttribute(
    "aria-label",
    isMaximized ? "Restaurar janela" : "Maximizar janela"
  );
  windowMaximizeButton.title = isMaximized ? "Restaurar" : "Maximizar";
}

async function initializeDesktopWindowControls() {
  if (!desktopApi?.isDesktop) {
    return;
  }

  try {
    updateWindowState(await desktopApi.getWindowState());
  } catch (_error) {
    updateWindowState({ isMaximized: false });
  }

  desktopApi.onWindowStateChange(updateWindowState);
}

if (certificateMode) {
  certificateMode.addEventListener("change", async () => {
    if (!certificateMode.checked) {
      await discardSelectedCertificate();
      updateCertificateModeCopy();
      return;
    }

    certificateMode.disabled = true;
    const confirmed = await openCertificateDialog();
    certificateMode.disabled = false;

    if (!confirmed) {
      certificateMode.checked = false;
      await discardSelectedCertificate();
    }

    updateCertificateModeCopy();
  });
}

if (selectCertificateButton) {
  selectCertificateButton.addEventListener("click", async () => {
    setCertificateDialogMessage("");

    if (!desktopApi?.isDesktop) {
      certificateFileInput?.click();
      return;
    }

    try {
      const selection = await desktopApi.selectCertificate();
      if (selection?.canceled) {
        return;
      }

      certificateDraft = {
        certificateId: selection.certificateId,
        fileName: selection.fileName
      };
      updateCertificateFileName();
    } catch (error) {
      setCertificateDialogMessage(error.message || "Nao foi possivel selecionar o certificado.");
    }
  });
}

if (certificateFileInput) {
  certificateFileInput.addEventListener("change", () => {
    const [file] = certificateFileInput.files;
    if (!file) {
      return;
    }

    certificateDraft = {
      file,
      fileName: file.name
    };
    updateCertificateFileName();
    setCertificateDialogMessage("");
  });
}

if (certificateCancelButton) {
  certificateCancelButton.addEventListener("click", () => {
    certificateDialog?.close("cancel");
  });
}

if (certificateForm) {
  certificateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    certificateConfirmButton.disabled = true;
    selectCertificateButton.disabled = true;
    setCertificateDialogMessage("Validando certificado...");

    try {
      const certificate = await inspectCertificateDraft();
      const owner = certificate.commonName ? ` — ${certificate.commonName}` : "";
      setCertificateDialogMessage(
        `Certificado validado para o CNPJ ${certificate.formattedCnpj}${owner}.`,
        { success: true }
      );
      certificateDialog.close("confirm");
    } catch (error) {
      setCertificateDialogMessage(error.message || "Nao foi possivel validar o certificado.");
    } finally {
      certificateConfirmButton.disabled = false;
      selectCertificateButton.disabled = false;
    }
  });
}

async function runSecretDiagnostics() {
  if (submitButton.disabled || document.querySelector("dialog[open]")) return;
  const rawKeys = rawKeysField.value.trim();
  if (!rawKeys) {
    summary.textContent = "Informe as chaves no bloco de entrada para iniciar o diagnostico.";
    return;
  }
  setControlsDisabled(true);
  clearResults("Diagnostico do site...", "Registrando console e respostas de rede. As tentativas com erro terao HTML e captura da tela.");
  summary.textContent = "Iniciando diagnostico no navegador headless...";
  const startedAt = Date.now();
  try {
    const response = await fetch("/api/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawKeys })
    });
    if (!response.ok) {
      const data = await readJsonSafely(response);
      throw new Error(data.error || "Falha ao iniciar o diagnostico.");
    }
    const state = await consumeResultStream(response, "Diagnostico do site");
    if (!state.diagnosticReport) throw new Error(state.failedMessage || "O diagnostico terminou sem disponibilizar o relatorio.");
    const diagnostic = state.diagnosticReport;
    const report = buildFinalReport({ label: "Diagnostico do site", results: state.results, startedAt, finishedAt: Date.now(), failedMessage: state.failedMessage });
    saveReport(report);
    const link = document.createElement("a");
    link.href = diagnostic.downloadUrl;
    link.download = diagnostic.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    summary.textContent += ` Relatorio ZIP gerado. Evidencias salvas em ${diagnostic.directory}.`;
  } catch (error) {
    summary.textContent = error.message || "Falha ao realizar o diagnostico.";
  } finally {
    setControlsDisabled(false);
  }
}

document.addEventListener("keydown", (event) => {
  const asterisk = event.key === "*" || event.code === "NumpadMultiply" || event.code === "Digit8";
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || !asterisk) return;
  event.preventDefault();
  if (!event.repeat) runSecretDiagnostics();
});

const organizationDialog = document.querySelector("#organizationDialog");
const organizationForm = document.querySelector("#organizationForm");
const organizationType = document.querySelector("#organizationType");
const organizationCnpj = document.querySelector("#organizationCnpj");
const organizationHelp = document.querySelector("#organizationHelp");
const organizationMessage = document.querySelector("#organizationMessage");
let activeOrganization = null;

function updateOrganizationHelp() {
  organizationMessage.textContent = "";
  const automatic = organizationType.value === "auto";
  organizationCnpj.required = automatic;
  organizationHelp.textContent = automatic
    ? "Informe o CNPJ: notas emitidas pela empresa serao saidas; notas recebidas serao entradas."
    : "CNPJ opcional. Se vazio, entradas usam o CNPJ do destinatario e saidas usam o CNPJ do emitente. O periodo sera o mes de emissao.";
}

organizationType.addEventListener("change", updateOrganizationHelp);
organizationCnpj.addEventListener("input", () => { organizationMessage.textContent = ""; });
document.querySelector("#organizationCancel").addEventListener("click", () => organizationDialog.close("cancel"));
organizationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const rawCnpj = organizationCnpj.value.trim();
  const cnpj = rawCnpj.replace(/[.\/\-\s]/g, "");
  if ((rawCnpj && !/^\d{14}$/.test(cnpj)) || (organizationType.value === "auto" && !cnpj)) {
    organizationMessage.textContent = "Informe um CNPJ com 14 digitos.";
    organizationCnpj.focus();
    return;
  }
  activeOrganization = { type: organizationType.value, cnpj };
  organizationDialog.close("confirm");
});

function requestOrganization() {
  organizationDialog.returnValue = "";
  organizationMessage.textContent = "";
  organizationCnpj.value = certificateState?.formattedCnpj || activeOrganization?.cnpj || "";
  updateOrganizationHelp();
  return new Promise((resolve) => {
    organizationDialog.addEventListener("close", () => {
      resolve(organizationDialog.returnValue === "confirm");
    }, { once: true });
    organizationDialog.showModal();
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const rawKeys = rawKeysField.value.trim();
  if (!rawKeys) {
    summary.textContent = "Informe ao menos uma chave.";
    return;
  }

  let certificatePayload;
  try {
    certificatePayload = getCertificatePayload();
  } catch (error) {
    summary.textContent = error.message || "Selecione um certificado digital valido.";
    return;
  }

  setControlsDisabled(true);
  if (certificatePayload) {
    activeOrganization = {
      type: "auto",
      cnpj: certificateState.formattedCnpj.replace(/\D/g, ""),
      requireXmlMetadata: true
    };
  } else if (!(await requestOrganization())) {
    setControlsDisabled(false);
    return;
  }

  const usingCertificate = Boolean(certificatePayload);
  const processingLabel = usingCertificate ? "Chaves com certificado" : "Chaves processadas";
  const startedAt = Date.now();
  setControlsDisabled(true);
  summary.textContent = usingCertificate
    ? "Consultando a SEFAZ com o certificado selecionado..."
    : "Processando chaves...";
  clearResults(
    "Processando...",
    usingCertificate
      ? "A SEFAZ validara o vinculo entre cada chave e a empresa do certificado."
      : "Cada resultado sera exibido assim que a consulta dessa chave terminar."
  );

  try {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rawKeys,
        organization: activeOrganization,
        ...(certificatePayload || {}),
        keepCertificate: usingCertificate
      })
    });

    if (!response.ok) {
      const data = await readJsonSafely(response);
      throw new Error(data.error || "Falha ao iniciar o processamento.");
    }

    const state = await consumeResultStream(response, processingLabel);
    const finalState = await finalizeCompletedRound({
      state,
      label: processingLabel,
      reportLabel: processingLabel,
      startedAt,
      certificatePayload
    });

    if (finalState.failedMessage && finalState.results.length === 0) {
      clearResults("Falha na consulta", "Revise os dados enviados e tente novamente.");
    }
  } catch (error) {
    summary.textContent = error.message || "Erro ao processar as chaves.";
    saveReport(
      buildFinalReport({
        label: processingLabel,
        results: [],
        failedMessage: error.message || "Erro ao processar as chaves.",
        startedAt,
        finishedAt: Date.now()
      })
    );
    clearResults("Falha na consulta", "Revise os dados enviados e tente novamente.");
  } finally {
    setControlsDisabled(false);
    if (usingCertificate) {
      certificateMode.checked = false;
      await discardSelectedCertificate();
      updateCertificateModeCopy();
    }
  }
});

async function processUploadedFiles({
  files,
  fieldName,
  endpoint,
  emptyMessage,
  progressMessage,
  label,
  reportLabel,
  waitingTitle,
  waitingCopy,
  failureTitle,
  failureCopy
}) {
  if (files.length === 0) {
    summary.textContent = emptyMessage;
    return;
  }

  let certificatePayload;
  try {
    certificatePayload = getCertificatePayload();
  } catch (error) {
    summary.textContent = error.message || "Selecione um certificado digital valido.";
    return;
  }

  setControlsDisabled(true);
  if (certificatePayload) {
    activeOrganization = {
      type: "auto",
      cnpj: certificateState.formattedCnpj.replace(/\D/g, ""),
      requireXmlMetadata: true
    };
  } else if (!(await requestOrganization())) {
    setControlsDisabled(false);
    return;
  }

  const usingCertificate = Boolean(certificatePayload);
  const activeLabel = usingCertificate ? `${label} com certificado` : label;
  const activeReportLabel = usingCertificate ? `${reportLabel} com certificado` : reportLabel;
  const startedAt = Date.now();
  setControlsDisabled(true);
  summary.textContent = usingCertificate
    ? "Consultando a SEFAZ com o certificado selecionado..."
    : progressMessage;
  clearResults(
    waitingTitle,
    usingCertificate
      ? "A SEFAZ validara o vinculo entre cada chave encontrada e a empresa do certificado."
      : waitingCopy
  );

  try {
    const formData = new FormData();
    formData.append("organization", JSON.stringify(activeOrganization));
    for (const file of files) {
      formData.append(fieldName, file);
    }
    if (certificatePayload) {
      formData.append("certificateId", certificatePayload.certificateId);
      formData.append("certificatePassphrase", certificatePayload.certificatePassphrase);
      formData.append("certificateAuthorUf", certificatePayload.certificateAuthorUf);
      formData.append("keepCertificate", "true");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const data = await readJsonSafely(response);
      throw new Error(data.error || "Falha ao processar os arquivos.");
    }

    const state = await consumeResultStream(response, activeLabel);
    const finalState = await finalizeCompletedRound({
      state,
      label: activeLabel,
      reportLabel: activeReportLabel,
      startedAt,
      certificatePayload
    });

    if (finalState.failedMessage && finalState.results.length === 0) {
      clearResults(failureTitle, failureCopy);
    }
  } catch (error) {
    summary.textContent = error.message || "Erro ao processar os arquivos.";
    saveReport(
      buildFinalReport({
        label: activeReportLabel,
        results: [],
        failedMessage: error.message || "Erro ao processar os arquivos.",
        startedAt,
        finishedAt: Date.now()
      })
    );
    clearResults(failureTitle, failureCopy);
  } finally {
    setControlsDisabled(false);
    if (usingCertificate) {
      certificateMode.checked = false;
      await discardSelectedCertificate();
      updateCertificateModeCopy();
    }
  }
}

async function processPdfFiles() {
  return processUploadedFiles({
    files: [...pdfFilesField.files],
    fieldName: "pdfs",
    endpoint: "/api/process-pdfs",
    emptyMessage: "Selecione ao menos um PDF.",
    progressMessage: "Lendo PDFs e consultando XMLs...",
    label: "Resultados PDF",
    reportLabel: "Resultados PDF",
    waitingTitle: "Processando PDFs...",
    waitingCopy: "Cada PDF e exibido na lista assim que a extracao e a consulta correspondente terminam.",
    failureTitle: "Falha na leitura",
    failureCopy: "Nao foi possivel concluir a extracao dos PDFs enviados."
  });
}

async function processSpreadsheetFiles() {
  return processUploadedFiles({
    files: [...spreadsheetFilesField.files],
    fieldName: "spreadsheets",
    endpoint: "/api/process-spreadsheets",
    emptyMessage: "Selecione ao menos uma planilha.",
    progressMessage: "Lendo planilhas e consultando XMLs...",
    label: "Resultados planilha",
    reportLabel: "Resultados planilha",
    waitingTitle: "Processando planilhas...",
    waitingCopy:
      'Cada linha com a coluna "Chave de Acesso" e exibida na lista assim que a consulta correspondente termina.',
    failureTitle: "Falha na leitura",
    failureCopy: "Nao foi possivel concluir a leitura das planilhas enviadas."
  });
}

pdfSubmitButton.addEventListener("click", processPdfFiles);
spreadsheetSubmitButton.addEventListener("click", processSpreadsheetFiles);
pdfFilesField.addEventListener("change", updatePdfFileSummary);
spreadsheetFilesField.addEventListener("change", updateSpreadsheetFileSummary);
if (copyReportButton) {
  copyReportButton.addEventListener("click", copyCurrentReport);
}

if (downloadReportButton) {
  downloadReportButton.addEventListener("click", downloadCurrentReport);
}

if (closeCertificateReportButton) {
  closeCertificateReportButton.addEventListener("click", () => {
    certificateReportDialog?.close();
  });
}

if (downloadCertificateReportButton) {
  downloadCertificateReportButton.addEventListener("click", downloadCertificateReportXlsx);
}

if (downloadsDirField) {
  downloadsDirField.addEventListener("click", selectDownloadsDir);
  downloadsDirField.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectDownloadsDir();
    }
  });
}

if (windowMinimizeButton && desktopApi?.isDesktop) {
  windowMinimizeButton.addEventListener("click", () => {
    desktopApi.minimizeWindow();
  });
}

if (windowMaximizeButton && desktopApi?.isDesktop) {
  windowMaximizeButton.addEventListener("click", () => {
    desktopApi.toggleMaximizeWindow();
  });
}

if (windowCloseButton && desktopApi?.isDesktop) {
  windowCloseButton.addEventListener("click", () => {
    desktopApi.closeWindow();
  });
}

clearResults();
updatePdfFileSummary();
updateSpreadsheetFileSummary();
updateCertificateModeCopy();
loadConfig();
loadSavedReport();
initializeDesktopWindowControls();
