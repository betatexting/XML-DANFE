import { companyContext } from "./company-context.js";
import { calendarToday } from "./calendar-period-model.mjs";
import { downloadFiscalXml } from "./fiscal-xml-download.js";
const desktop = window.consultaDanfeDesktop;
if (desktop?.isDesktop) {
  document.body.classList.add("is-desktop");
  document.querySelector("#sheetsMinimize").addEventListener("click", () => desktop.minimizeWindow());
  document.querySelector("#sheetsClose").addEventListener("click", () => desktop.closeWindow());
}
const companySelect = document.querySelector("#sheetCompany"), fromInput = document.querySelector("#sheetFrom"), toInput = document.querySelector("#sheetTo");
const list = document.querySelector("#sheetList"), jobs = document.querySelector("#sheetJobs"), message = document.querySelector("#sheetMessage");
const collectionFeedback = document.querySelector("#sheetCollectionFeedback");
const collectionStatus = document.querySelector("#sheetCollectionStatus");
const collect = document.querySelector("#collectSheets"), cancel = document.querySelector("#cancelCollection"), challenge = document.querySelector("#sheetChallenge");
const cte = document.querySelector("#sheetCte"), cteForm = document.querySelector("#sheetCteForm");
const cteSaved = document.querySelector("#sheetCteSaved"), cteKey = document.querySelector("#sheetCteKey");
const cteMessage = document.querySelector("#sheetCteMessage"), cteXml = document.querySelector("#sheetCteXml"), cteEvents = document.querySelector("#sheetCteEvents");
const cteFeedback = document.querySelector("#sheetCteFeedback"), cteStatus = document.querySelector("#sheetCteStatus");
const cteSubmit = cteForm.querySelector("button");
const cteCollect = document.querySelector("#sheetCteCollect");
const fiscalForm = document.querySelector("#sheetFiscalForm");
const fiscalMessage = document.querySelector("#sheetFiscalMessage");
fiscalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const company = companySelect.value;
  if (!company) { fiscalMessage.textContent = "Selecione uma empresa."; return; }
  const button = fiscalForm.querySelector("button");
  button.disabled = true;
  fiscalMessage.textContent = "Preparando o ZIP dos XMLs salvos…";
  try {
    await downloadFiscalXml(company, document.querySelector("#sheetFiscalType").value, document.querySelector("#sheetFiscalMonth").value);
    if (companySelect.value === company) fiscalMessage.textContent = "ZIP disponível para salvar.";
  } catch (error) {
    if (companySelect.value === company) fiscalMessage.textContent = error.message;
  } finally { button.disabled = false; }
});
companySelect.addEventListener("change", () => { fiscalMessage.textContent = ""; });
let cteVersion = 0;
function setCteBusy(busy) {
  cteSubmit.disabled = cteCollect.disabled = busy || !companySelect.value;
  cteKey.disabled = cteSaved.disabled = busy;
}
const today = calendarToday(), previous = new Date(Date.UTC(today.year, today.month - 1, 0));
fromInput.value = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-01`;
toInput.value = previous.toISOString().slice(0, 10);
let revision = 0, currentJob = null, currentChallenge = null, polling = false;
const done = new Set(["completed", "partial", "empty", "failed", "cancelled", "interrupted"]);
const successful = new Set(["completed", "empty"]);
const loginStages = { filling_credentials: "Preenchendo o login", submitting_login: "Enviando o login", confirming_login: "Aguardando a confirmação do login no portal", collecting_mdfe: "Lendo eventos de MDF-e nas NF-e" };
const labels = { queued: "Na fila", starting: "Iniciando coleta", authenticating: "Acessando o portal", consulting: "Consultando período", awaiting_captcha: "Aguardando código da imagem", downloading: "Baixando planilha", importing: "Importando chaves", splitting: "Dividindo período por limite do portal", empty_part: "Trecho sem resultados", completed: "Concluída", partial: "Parcial — confira as pendências", empty: "Sem resultados", failed: "Falhou", cancelled: "Cancelada", interrupted: "Interrompida ao fechar o aplicativo" };
const errors = { invalid_credentials: "O portal recusou o login ou a senha cadastrados.", credentials_unavailable: "Confira as credenciais SEFAZ no cadastro do aplicativo desktop.", captcha_timeout: "O prazo para informar o código da imagem terminou.", captcha_rejected: "O portal recusou o código da imagem.", session_expired: "A sessão no portal expirou.", spreadsheet_invalid: "A planilha recebida não contém chaves NF-e válidas.", browser_unavailable: "O navegador de consultas não pôde ser iniciado.", portal_navigation_failed: "Não foi possível concluir a navegação no portal.", portal_tls_error: "Não foi possível validar a cadeia HTTPS e o domínio da SEFAZ.", portal_unavailable: "O portal está indisponível.", record_limit: "Um trecho excedeu o limite de registros do portal.", query_timeout: "Um trecho não respondeu no prazo esperado." };
const filters = () => ({ companyId: companySelect.value, from: fromInput.value, to: toInput.value });
async function request(url, options) { const response = await fetch(url, options); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível acessar as planilhas."); return data; }
const post = (url, body = {}) => request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const cteUrl = () => `/api/companies/${encodeURIComponent(companySelect.value)}/cte`;
function showCteFeedback(state, label = "", detail = "") {
  cteFeedback.hidden = !state;
  cteFeedback.dataset.state = state;
  cteStatus.textContent = label;
  cteMessage.textContent = detail;
}
function clearCteResult() {
  cteXml.hidden = true;
  cteEvents.hidden = true;
  cteEvents.replaceChildren();
}
function renderCteKeys(documents) {
  const selected = cteSaved.value;
  const keys = [...new Set(documents.map(({ key }) => key))];
  cteSaved.replaceChildren(new Option(keys.length ? "Selecione uma chave" : "Nenhuma chave coletada", ""),
    ...keys.map((key) => new Option(key, key)));
  if (keys.includes(selected)) cteSaved.value = selected;
}
async function loadCteKeys() {
  const version = ++cteVersion;
  cteKey.value = "";
  cteSaved.replaceChildren(new Option("Selecione uma chave", ""));
  clearCteResult();
  showCteFeedback("");
  setCteBusy(false);
  if (!cte.open || !companySelect.value) return;
  try {
    const { documents } = await request(cteUrl(), { cache: "no-store" });
    if (version !== cteVersion) return;
    renderCteKeys(documents);
  } catch {
    if (version === cteVersion) cteSaved.options[0].textContent = "Chaves coletadas indisponíveis";
  }
}
cte.addEventListener("toggle", () => { if (cte.open) loadCteKeys(); });
function resetCteInput() {
  cteVersion++;
  clearCteResult();
  showCteFeedback("");
  setCteBusy(false);
}
cteSaved.addEventListener("change", () => { cteKey.value = cteSaved.value; resetCteInput(); });
cteKey.addEventListener("input", resetCteInput);
cteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!companySelect.value || cteSubmit.disabled) return;
  const key = cteKey.value.replace(/\s/g, "");
  clearCteResult();
  if (!/^\d{20}(?:57|67|64)\d{22}$/.test(key)) {
    showCteFeedback("error", "Chave inválida", "Informe uma chave de CT-e de 44 dígitos.");
    return;
  }
  const version = ++cteVersion;
  const url = cteUrl();
  setCteBusy(true);
  showCteFeedback("pending", "Consultando CT-e", "Aguardando resposta da SEFAZ…");
  try {
    const data = await post(url + "/situation", { key });
    if (version !== cteVersion) return;
    const detail = `SEFAZ (${data.status}) — ${data.reason}${data.protocol ? ` · Protocolo ${data.protocol}` : ""}`;
    showCteFeedback("complete", "Consulta finalizada", detail);
    for (const fiscalEvent of data.events) {
      const line = document.createElement("li");
      line.textContent = [fiscalEvent.description || `Evento ${fiscalEvent.type}`, fiscalEvent.protocol].filter(Boolean).join(" · ");
      cteEvents.append(line);
    }
    cteEvents.hidden = !data.events.length;
    if (data.nsu) {
      cteXml.href = `${url}/${encodeURIComponent(data.nsu)}/xml`;
      cteXml.hidden = false;
    }
  } catch (error) {
    if (version === cteVersion) showCteFeedback("error", "Consulta falhou", error.message);
  } finally {
    if (version === cteVersion) setCteBusy(false);
  }
});
cteCollect.addEventListener("click", async () => {
  if (!companySelect.value || cteCollect.disabled) return;
  const version = ++cteVersion;
  clearCteResult();
  setCteBusy(true);
  showCteFeedback("pending", "Buscando chaves de CT-e", "Aguardando o lote do Ambiente Nacional…");
  try {
    const data = await post(cteUrl());
    if (version !== cteVersion) return;
    renderCteKeys(data.documents);
    const next = Date.parse(data.nextAllowedAt);
    const readyAt = Number.isFinite(next) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bahia" }).format(next) : "";
    const summary = data.waiting ? `${data.documents.length} CT-e já coletado(s).` :
      `${data.added} CT-e novo(s). ${data.documents.length} disponível(is) no seletor.`;
    showCteFeedback(data.waiting ? "pending" : "complete", data.waiting ? "Intervalo de consulta" : "Busca finalizada",
      summary + (readyAt ? ` Próxima busca a partir de ${readyAt}.` : ""));
  } catch (error) {
    if (version === cteVersion) showCteFeedback("error", "Busca falhou", error.message);
  } finally {
    if (version === cteVersion) setCteBusy(false);
  }
});
function valid() { return companySelect.value && fromInput.value && toInput.value && fromInput.value <= toInput.value; }
function jobMatches(job) { const f = filters(); return job && job.companyId === f.companyId && job.from >= f.from && job.to <= f.to; }
function showCollectionFeedback(state, title = "", detail = "") {
  collectionStatus.textContent = title;
  message.textContent = detail;
  collectionFeedback.hidden = !state;
  collectionFeedback.dataset.state = state;
}
function renderJob(job) {
  if (!jobMatches(job)) return;
  const terminal = done.has(job.status);
  const title = successful.has(job.status) ? "Consulta finalizada" :
    terminal ? (job.status === "failed" ? "Consulta falhou" : labels[job.status]) :
    job.status === "awaiting_captcha" ? "Aguardando código da imagem" : "Consultando NF-e";
  const reason = job.code === "login_timeout" ? "O portal não confirmou o login no prazo esperado." : errors[job.code];
  showCollectionFeedback(terminal ? (successful.has(job.status) ? "complete" : "error") : "pending", title,
    `${loginStages[job.status] || labels[job.status] || "Coleta em andamento"}. ${job.sheetCount} planilha(s), ${job.keyCount} chave(s) novas, ${job.duplicateCount} duplicada(s).${job.code ? " " + (reason || `Motivo: ${job.code}.`) : ""}`);
  cancel.hidden = done.has(job.status); collect.disabled = !done.has(job.status) || !valid();
  currentChallenge = job.challenge || null; challenge.hidden = !currentChallenge;
  if (currentChallenge) document.querySelector("#sheetCaptchaImage").src = currentChallenge.image;
}
async function refreshList() {
  const version = ++revision; list.replaceChildren(); jobs.replaceChildren(); challenge.hidden = true; cancel.hidden = true;
  document.querySelector("#sheetPreview").hidden = true; collect.disabled = !valid();
  if (!valid()) { showCollectionFeedback("pending", "Seleção necessária", "Selecione a empresa e um período válido."); return; }
  try {
    const f = filters(), data = await request("/api/key-sheets?" + new URLSearchParams(f));
    if (version !== revision) return;
    list.textContent = data.sheets.length ? "" : "Nenhuma planilha importada para esta empresa e período.";
    for (const sheet of data.sheets) {
      const row = document.createElement("div"); row.className = "sheet-row";
      const text = document.createElement("div"), title = document.createElement("p"), count = document.createElement("p");
      title.textContent = `${sheet.direction === "entradas" ? "Entradas" : "Saídas"} · ${sheet.from} a ${sheet.to}`;
      count.textContent = `${sheet.recordCount} chave(s) · ${sheet.duplicateCount} duplicada(s) · ${sheet.rejectedCount} linha(s) rejeitada(s)`;
      text.append(title, count); const actions = document.createElement("div"); actions.className = "sheet-row-actions";
      if (sheet.hasMdfeReport) {
        const report = document.createElement("a");
        report.textContent = "Baixar eventos de MDF-e";
        report.href = `/api/key-sheets/${sheet.id}/mdfe-events?` + new URLSearchParams({ companyId: f.companyId });
        report.download = "eventos-mdfe-por-nfe.xlsx";
        actions.append(report);
      }
      const preview = document.createElement("button"); preview.type = "button"; preview.textContent = "Ver chaves";
      preview.addEventListener("click", async () => {
        const selectedVersion = revision;
        try {
          const detail = await request(`/api/key-sheets/${sheet.id}?` + new URLSearchParams({ companyId: f.companyId }));
          if (selectedVersion !== revision) return;
          document.querySelector("#sheetKeys").value = detail.records.map((record) => record.key).join("\n");
          document.querySelector("#sheetPreviewMessage").textContent = detail.truncated ? "Prévia das primeiras 1.000 chaves. A planilha original contém todas as linhas." : `${detail.recordCount} chave(s).`;
          const panel = document.querySelector("#sheetPreview"); panel.hidden = false; panel.open = true;
        } catch (error) { message.textContent = error.message; }
      });
      const link = document.createElement("a"); link.textContent = "Baixar planilha"; link.href = `/api/key-sheets/${sheet.id}/file?` + new URLSearchParams({ companyId: f.companyId }); link.download = "";
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          const response = await fetch(link.href); if (!response.ok) throw new Error("Não foi possível baixar a planilha.");
          const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
          anchor.href = url; anchor.download = sheet.sourceName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (error) { message.textContent = error.message; }
      });
      actions.append(preview, link); row.append(text, actions); list.append(row);
    }
    jobs.textContent = data.jobs.length ? "" : "Nenhuma coleta neste período.";
    for (const job of data.jobs) {
      const row = document.createElement("div"); row.className = "sheet-row";
      row.textContent = `${job.from} a ${job.to} · ${loginStages[job.status] || labels[job.status] || job.status}${job.code ? " · " + (errors[job.code] || job.code) : ""}`; jobs.append(row);
    }
    const running = data.jobs.find((job) => !done.has(job.status));
    if (running) { currentJob = running; renderJob(running); poll(); }
    else {
      currentJob = null;
      const latest = data.jobs[0];
      if (latest) renderJob(latest);
      else showCollectionFeedback("");
    }
  } catch (error) { if (version === revision) showCollectionFeedback("error", "Falha ao atualizar a lista", error.message); }
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    while (currentJob && jobMatches(currentJob) && !done.has(currentJob.status)) {
      const id = currentJob.id, job = await request(`/api/key-collections/${id}`);
      if (currentJob?.id !== id || !jobMatches(job)) break;
      currentJob = job; renderJob(job);
      if (done.has(job.status)) { await refreshList(); break; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) { showCollectionFeedback("error", "Falha ao acompanhar a coleta", error.message); currentJob = null; collect.disabled = !valid(); }
  finally { polling = false; if (currentJob && jobMatches(currentJob) && !done.has(currentJob.status)) setTimeout(poll, 1000); }
}
document.querySelector("#sheetFilters").addEventListener("submit", (event) => { event.preventDefault(); refreshList(); });
companySelect.addEventListener("change", async () => { currentJob = null; loadCteKeys(); await refreshList(); if (companySelect.value) companyContext.select(companySelect.value).catch(() => {}); });
for (const input of [fromInput, toInput]) input.addEventListener("change", () => { currentJob = null; refreshList(); });
collect.addEventListener("click", async () => {
  if (!valid()) return; collect.disabled = true;
  showCollectionFeedback("pending", "Consultando NF-e", "Iniciando a coleta na SEFAZ…");
  try {
    const direction = document.querySelector("#sheetDirection").value;
    currentJob = await post("/api/key-collections", {
      ...filters(), directions: direction === "both" ? ["saidas", "entradas"] : [direction],
      includeMdfeEvents: document.querySelector("#includeMdfeEvents").checked
    });
    renderJob(currentJob);
    poll();
  }
  catch (error) { showCollectionFeedback("error", "Consulta falhou", error.message); collect.disabled = !valid(); }
});
cancel.addEventListener("click", () => { if (currentJob) post(`/api/key-collections/${currentJob.id}/cancel`).catch((error) => { message.textContent = error.message; }); });
document.querySelector("#sheetCaptchaSubmit").addEventListener("click", async () => {
  if (!currentJob || !currentChallenge) return;
  try { await post(`/api/key-collections/${currentJob.id}/captcha`, { token: currentChallenge.token, answer: document.querySelector("#sheetCaptchaAnswer").value.trim() }); document.querySelector("#sheetCaptchaAnswer").value = ""; challenge.hidden = true; }
  catch (error) { message.textContent = error.message; }
});
async function loadCompanies() {
  try {
    await companyContext.refresh(); const previousId = companySelect.value;
    companySelect.replaceChildren(new Option("Selecionar empresa", ""));
    for (const company of companyContext.state.companies) companySelect.append(new Option(company.legalName, company.id));
    companySelect.value = previousId || companyContext.state.selectedCompanyId || ""; loadCteKeys(); await refreshList();
  } catch { message.textContent = "Não foi possível carregar as empresas cadastradas."; }
}
desktop?.onCompanyRegistered?.(loadCompanies);
loadCompanies();
