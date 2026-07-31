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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const rawKeys = rawKeysField.value.trim();
  if (!rawKeys) {
    summary.textContent = "Informe ao menos uma chave.";
    return;
  }

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

    if (state.failedMessage && state.results.length === 0) {
      clearResults("Falha na consulta", "Revise os dados enviados e tente novamente.");
    }
  } catch (error) {
    summary.textContent = error.message || "Erro ao processar as chaves.";
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

    if (state.failedMessage && state.results.length === 0) {
      clearResults("Falha na leitura", "Nao foi possivel concluir a extracao dos PDFs enviados.");
    }
  } catch (error) {
    summary.textContent = error.message || "Erro ao processar os PDFs.";
    clearResults("Falha na leitura", "Nao foi possivel concluir a extracao dos PDFs enviados.");
  } finally {
    setControlsDisabled(false);
  }
}

pdfSubmitButton.addEventListener("click", processPdfFiles);
pdfFilesField.addEventListener("change", updateFileSummary);

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
