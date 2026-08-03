const form = document.querySelector("#process-form");
const rawKeysField = document.querySelector("#rawKeys");
const headlessField = document.querySelector("#headless");
const submitButton = document.querySelector("#submitButton");
const pdfFilesField = document.querySelector("#pdfFiles");
const pdfSubmitButton = document.querySelector("#pdfSubmitButton");
const summary = document.querySelector("#summary");
const resultsList = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");
const emptyTitle = document.querySelector("#emptyTitle");
const emptyCopy = document.querySelector("#emptyCopy");
const fileSummary = document.querySelector("#fileSummary");
const downloadsDirField = document.querySelector("#downloadsDir");
const reportMeta = document.querySelector("#reportMeta");
const reportOutput = document.querySelector("#reportOutput");
const copyReportButton = document.querySelector("#copyReportButton");
const downloadReportButton = document.querySelector("#downloadReportButton");
const REPORT_STORAGE_KEY = "consultaDanfe:lastReport";
let currentReportText = "";
let currentReportFileName = "";

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
  pdfSubmitButton.disabled = disabled || pdfFilesField.files.length === 0;
}

function updateFileSummary() {
  if (!fileSummary) {
    pdfSubmitButton.disabled = submitButton.disabled || pdfFilesField.files.length === 0;
    return;
  }

  const files = [...pdfFilesField.files];

  if (files.length === 0) {
    fileSummary.textContent = "Nenhum PDF selecionado.";
    pdfSubmitButton.disabled = submitButton.disabled;
    return;
  }

  if (files.length === 1) {
    fileSummary.textContent = files[0].name;
    pdfSubmitButton.disabled = submitButton.disabled;
    return;
  }

  const preview = files
    .slice(0, 2)
    .map((file) => file.name)
    .join(", ");
  const suffix = files.length > 2 ? ` +${files.length - 2}` : "";

  fileSummary.textContent = `${files.length} PDFs: ${preview}${suffix}`;
  pdfSubmitButton.disabled = submitButton.disabled;
}

function createResultMarkup(result) {
  const badgeClass = result.status === "success" ? "success" : "error";
  const badgeText = result.status === "success" ? "Baixado" : "Falhou";
  const title = result.key || result.sourceName || "Resultado";
  const itemClass = result.status === "success" ? "is-success" : "is-error";
  const details = [];

  if (result.sourceName) {
    details.push({
      label: "PDF",
      value: result.sourceName
    });
  }

  if (result.key) {
    details.push({
      label: "Chave",
      value: result.key
    });
  }

  if (result.status === "success") {
    details.push({
      label: "Arquivo",
      value: result.fileName
    });
  } else {
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

function describeResult(result) {
  const parts = [];

  if (result.sourceName) {
    parts.push(`PDF ${result.sourceName}`);
  }

  if (result.key) {
    parts.push(`Chave ${result.key}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Item sem identificador";
}

function buildReportFileName(label, finishedAt) {
  const normalizedLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `relatorio-${normalizedLabel || "consulta"}-${formatFileTimestamp(finishedAt)}.txt`;
}

function buildFinalReport({ label, results, failedMessage, startedAt, finishedAt }) {
  const { successCount, errorCount } = getResultCounts(results);
  const succeeded = results.filter((item) => item.status === "success");
  const failed = results.filter((item) => item.status !== "success");
  const summaryText = `${successCount} ok / ${errorCount} falhas / ${results.length} total.`;
  const statusText = failedMessage
    ? "interrompido"
    : errorCount > 0
      ? "concluido com falhas"
      : "concluido sem falhas";
  const lines = [
    `Relatorio final - ${label}`,
    `Iniciado em: ${formatDateTime(startedAt)}`,
    `Finalizado em: ${formatDateTime(finishedAt)}`,
    `Status geral: ${statusText}`,
    `Resumo: ${summaryText}`
  ];

  if (failedMessage) {
    lines.push(`Mensagem final: ${failedMessage}`);
  }

  if (succeeded.length > 0) {
    lines.push("", "Sucessos:");

    for (const result of succeeded) {
      lines.push(`- ${describeResult(result)} -> ${result.fileName || "arquivo nao informado"}`);
    }
  }

  if (failed.length > 0) {
    lines.push("", "Falhas:");

    for (const result of failed) {
      lines.push(`- ${describeResult(result)} -> ${result.message || "erro desconhecido"}`);
    }
  }

  if (results.length === 0) {
    lines.push("", "Nenhum item foi concluido nesta rodada.");
  }

  return {
    label,
    startedAt,
    finishedAt,
    summaryText,
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

    if (payload.type === "complete") {
      state.total = Number.isFinite(payload.total) ? payload.total : state.total;
      state.isComplete = true;
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
  } catch (_error) {
    setDownloadsDirDisplay("Destino indisponivel no momento.");
  }
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const rawKeys = rawKeysField.value.trim();
  if (!rawKeys) {
    summary.textContent = "Informe ao menos uma chave.";
    return;
  }

  const startedAt = Date.now();
  setControlsDisabled(true);
  summary.textContent = "Processando chaves...";
  clearResults("Processando...", "Cada resultado sera exibido assim que a consulta dessa chave terminar.");

  try {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rawKeys,
        headless: headlessField.checked
      })
    });

    if (!response.ok) {
      const data = await readJsonSafely(response);
      throw new Error(data.error || "Falha ao iniciar o processamento.");
    }

    const state = await consumeResultStream(response, "Chaves processadas");
    saveReport(
      buildFinalReport({
        label: "Chaves processadas",
        results: state.results,
        failedMessage: state.failedMessage,
        startedAt,
        finishedAt: Date.now()
      })
    );

    if (state.failedMessage && state.results.length === 0) {
      clearResults("Falha na consulta", "Revise os dados enviados e tente novamente.");
    }
  } catch (error) {
    summary.textContent = error.message || "Erro ao processar as chaves.";
    saveReport(
      buildFinalReport({
        label: "Chaves processadas",
        results: [],
        failedMessage: error.message || "Erro ao processar as chaves.",
        startedAt,
        finishedAt: Date.now()
      })
    );
    clearResults("Falha na consulta", "Revise os dados enviados e tente novamente.");
  } finally {
    setControlsDisabled(false);
  }
});

async function processPdfFiles() {
  const files = [...pdfFilesField.files];
  if (files.length === 0) {
    summary.textContent = "Selecione ao menos um PDF.";
    return;
  }

  const startedAt = Date.now();
  setControlsDisabled(true);
  summary.textContent = "Lendo PDFs e consultando XMLs...";
  clearResults(
    "Processando PDFs...",
    "Cada PDF e exibido na lista assim que a extracao e a consulta correspondente terminam."
  );

  try {
    const formData = new FormData();
    for (const file of files) {
      formData.append("pdfs", file);
    }
    formData.append("headless", String(headlessField.checked));

    const response = await fetch("/api/process-pdfs", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const data = await readJsonSafely(response);
      throw new Error(data.error || "Falha ao processar os PDFs.");
    }

    const state = await consumeResultStream(response, "Resultados PDF");
    saveReport(
      buildFinalReport({
        label: "Resultados PDF",
        results: state.results,
        failedMessage: state.failedMessage,
        startedAt,
        finishedAt: Date.now()
      })
    );

    if (state.failedMessage && state.results.length === 0) {
      clearResults("Falha na leitura", "Nao foi possivel concluir a extracao dos PDFs enviados.");
    }
  } catch (error) {
    summary.textContent = error.message || "Erro ao processar os PDFs.";
    saveReport(
      buildFinalReport({
        label: "Resultados PDF",
        results: [],
        failedMessage: error.message || "Erro ao processar os PDFs.",
        startedAt,
        finishedAt: Date.now()
      })
    );
    clearResults("Falha na leitura", "Nao foi possivel concluir a extracao dos PDFs enviados.");
  } finally {
    setControlsDisabled(false);
  }
}

pdfSubmitButton.addEventListener("click", processPdfFiles);
pdfFilesField.addEventListener("change", updateFileSummary);
if (copyReportButton) {
  copyReportButton.addEventListener("click", copyCurrentReport);
}

if (downloadReportButton) {
  downloadReportButton.addEventListener("click", downloadCurrentReport);
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

clearResults();
updateFileSummary();
loadConfig();
loadSavedReport();
