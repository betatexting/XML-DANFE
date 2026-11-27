import { companyContext } from "./company-context.js";
import { bindHoverPopover } from "./hover-popover.js";
import { initializeCalendarSelector } from "./calendar-selector.js";
import { initializeNoteSelector } from "./note-selector.js";
import { initializeNfseQueries } from "./nfse-queries.js";
import { initializeCteQueries } from "./cte-queries.js";
import { downloadFiscalXml } from "./fiscal-xml-download.js";

const desktop = window.consultaDanfeDesktop;
if (desktop?.isDesktop) {
  document.body.classList.add("is-desktop");
  document.querySelector(".login-window-actions").hidden = false;
  document.querySelector("#automaticNotesMinimize").addEventListener("click", () => desktop.minimizeWindow());
  document.querySelector("#automaticNotesClose").addEventListener("click", () => desktop.closeWindow());
}
const group = document.querySelector("#companyToolGroup");
const icon = document.querySelector("#companyToolButton");
const popup = document.querySelector("#companyPopover");
const select = document.querySelector("#companySelectButton");
const label = document.querySelector("#companySelectLabel");
const dropdown = document.querySelector("#companyDropdown");
const options = document.querySelector("#companyOptions");
const message = document.querySelector("#companySelectorMessage");
const mdfeResults = document.querySelector("#mdfeResults");
const mdfeQueries = document.querySelector("#mdfeQueries");
const mdfeKey = document.querySelector("#mdfeKey");
const mdfeFilter = document.querySelector("#mdfeFilter");
const mdfeMessage = document.querySelector("#mdfeMessage");
const mdfeServiceMessage = document.querySelector("#mdfeServiceMessage");
const mdfeDownloadMessage = document.querySelector("#mdfeDownloadMessage");
const mdfeArchiveForm = document.querySelector("#mdfeArchiveForm");
const mdfeArchiveMonth = document.querySelector("#mdfeArchiveMonth");
const mdfeArchiveMessage = document.querySelector("#mdfeArchiveMessage");
const mdfeExportKeys = document.querySelector("#mdfeExportKeys");
const mdfeControls = [...mdfeQueries.querySelectorAll("button")].filter((button) =>
  button.form !== mdfeArchiveForm && button !== mdfeExportKeys);
let mdfeRows = [];
let mdfeCollectedKeys = [];
const modules = [...document.querySelectorAll("[data-company-module]")];
let busy = false;
function closeDropdown() { dropdown.hidden = true; select.setAttribute("aria-expanded", "false"); }
const companyPopover = bindHoverPopover({ group, trigger: icon, popup, bridge: document.querySelector(".company-hover-bridge"), onClose: closeDropdown, isBusy: () => busy });
select.addEventListener("click", () => {
  dropdown.hidden = !dropdown.hidden;
  select.setAttribute("aria-expanded", String(!dropdown.hidden));
});
select.addEventListener("keydown", (event) => {
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault(); dropdown.hidden = false; select.setAttribute("aria-expanded", "true");
    const items = [...options.querySelectorAll("button")];
    ((event.key === "ArrowUp" ? items.at(-1) : items[0]) || document.querySelector("#createCompanyButton")).focus();
  }
});
options.addEventListener("keydown", (event) => {
  const items = [...options.querySelectorAll("button")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
});

function render() {
  const state = companyContext.state;
  const company = companyContext.selectedCompany;
  label.textContent = company?.legalName || (!state.loaded ? "Carregando empresas…" : state.companies.length ? "Selecionar empresa" : "Cadastrar empresa");
  select.title = company?.legalName || label.textContent;
  select.disabled = busy || !state.loaded;
  for (const button of modules) button.disabled = busy || !company;
  options.replaceChildren();
  for (const entry of state.companies) {
    const option = document.createElement("button");
    option.className = "company-option"; option.type = "button";
    option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(entry.id === state.selectedCompanyId));
    option.textContent = entry.legalName; option.disabled = busy;
    option.addEventListener("click", async () => {
      busy = true; message.textContent = ""; render();
      try { await companyContext.select(entry.id); closeDropdown(); }
      catch (error) { message.textContent = error.message; }
      finally { busy = false; render(); if (!popup.hidden) select.focus(); }
    });
    options.append(option);
  }
}
companyContext.subscribe(render);
async function refresh() {
  try { await companyContext.refresh(); message.textContent = ""; }
  catch { label.textContent = "Empresas indisponíveis"; message.textContent = "Não foi possível carregar as empresas. Tente abrir esta tela novamente."; }
}
document.addEventListener("company:registered", refresh);
desktop?.onCompanyRegistered?.(() => document.dispatchEvent(new CustomEvent("company:registered")));
document.addEventListener("company:create-request", (event) => {
  event.preventDefault();
  if (desktop?.openCompanyRegistration) {
    desktop.openCompanyRegistration().catch(() => { message.textContent = "Não foi possível abrir o cadastro de empresas."; });
  } else {
    window.open("/cadastro-empresa", "company-registration", "popup,width=780,height=690");
  }
});
document.querySelector("#createCompanyButton").addEventListener("click", () => {
  closeDropdown();
  const event = new CustomEvent("company:create-request", { cancelable: true });
  if (document.dispatchEvent(event)) message.textContent = "O formulário de cadastro será adicionado na próxima etapa.";
});
for (const button of modules) button.addEventListener("click", () => {
  const company = companyContext.selectedCompany;
  if (busy || !company) return;
  document.dispatchEvent(new CustomEvent("company-module:request", { detail: { module: button.dataset.companyModule, company } }));
});
document.addEventListener("company-module:request", ({ detail }) => {
  if (detail.module === "cte") mdfeQueries.hidden = true;
  if (detail.module !== "mdf") return;
  mdfeQueries.hidden = false;
  companyPopover.close();
  document.querySelector("#mdfeTitle").focus();
});
let mdfeCompanyId;
companyContext.subscribe(() => {
  const company = companyContext.selectedCompany;
  if (company?.id === mdfeCompanyId) return;
  mdfeCompanyId = company?.id;
  mdfeQueries.hidden ||= !company;
  document.querySelector("#mdfeCompany").textContent = company?.legalName || "";
  mdfeKey.value = "";
  mdfeFilter.value = "";
  mdfeRows = [];
  mdfeCollectedKeys = [];
  mdfeExportKeys.disabled = true;
  mdfeServiceMessage.textContent = "";
  mdfeDownloadMessage.textContent = "";
  mdfeArchiveMonth.value = "";
  mdfeArchiveMessage.textContent = "";
  mdfeMessage.textContent = "Selecione uma consulta para ver os manifestos.";
  renderMdfeRows();
});
function renderMdfeRows() {
  const filter = mdfeFilter.value.trim().toLocaleLowerCase("pt-BR");
  const visibleRows = mdfeRows.filter((row) => row.join(" ").toLocaleLowerCase("pt-BR").includes(filter));
  mdfeResults.replaceChildren();
  for (const values of visibleRows) {
    const row = mdfeResults.insertRow();
    for (const value of values) row.insertCell().textContent = value || "—";
  }
  if (mdfeRows.length && !visibleRows.length) {
    const cell = mdfeResults.insertRow().insertCell();
    cell.colSpan = 4;
    cell.textContent = "Nenhum resultado corresponde ao filtro.";
  }
}
mdfeFilter.addEventListener("input", renderMdfeRows);
mdfeExportKeys.addEventListener("click", () => {
  if (!mdfeCollectedKeys.length) return;
  const file = new Blob([mdfeCollectedKeys.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "chaves-mdfe-nao-encerrados.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
for (const button of mdfeQueries.querySelectorAll("[data-mdfe-query]")) {
  button.addEventListener("click", () => queryMdfe(button.dataset.mdfeQuery));
}
document.querySelector("#mdfeSituation").addEventListener("submit", (event) => {
  event.preventDefault();
  queryMdfe(event.submitter?.value === "xml" ? "xml" : "situation", mdfeKey.value);
});
mdfeArchiveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const company = companyContext.selectedCompany;
  if (!company) return;
  const { value: month } = mdfeArchiveMonth;
  const format = event.submitter?.value === "keys" ? "keys" : "zip";
  const buttons = mdfeArchiveForm.querySelectorAll("button");
  for (const button of buttons) button.disabled = true;
  mdfeArchiveMessage.textContent = "Preparando o arquivo…";
  try {
    await downloadFiscalXml(company.id, "mdfe", month, format);
    if (companyContext.selectedCompany?.id === company.id) mdfeArchiveMessage.textContent = "Arquivo disponível para salvar.";
  } catch (error) {
    if (companyContext.selectedCompany?.id === company.id) mdfeArchiveMessage.textContent = error.message;
  } finally {
    for (const button of buttons) button.disabled = false;
  }
});
async function queryMdfe(mode, key) {
  const company = companyContext.selectedCompany;
  if (!company || busy) return;
  busy = true;
  const updatesTable = mode === "open" || mode === "situation";
  const feedback = ["download", "xml"].includes(mode) ? mdfeDownloadMessage : mode === "status" ? mdfeServiceMessage : mdfeMessage;
  if (mode === "open") {
    mdfeCollectedKeys = [];
    mdfeExportKeys.disabled = true;
  }
  if (updatesTable) {
    mdfeRows = [];
    renderMdfeRows();
  }
  for (const button of mdfeControls) button.disabled = true;
  feedback.textContent = "Consultando MDF-e na SVRS…";
  render();
  try {
    const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}/mdfe/${mode}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    if (companyContext.selectedCompany?.id !== company.id) return;
    if (mode === "xml") {
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${key}-mdfe.xml`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      feedback.textContent = "XML validado e encaminhado para salvar.";
      return;
    }
    const result = await response.json();
    if (companyContext.selectedCompany?.id !== company.id) return;
    if (mode === "download") {
      if (result.state === "denied") feedback.textContent = "A SVRS recusou o acesso ao Download XML com o certificado desta empresa.";
      else if (result.state === "rate_limited") feedback.textContent = "A SVRS bloqueou o download por excesso de consultas deste IP.";
      else if (result.state === "form") {
        const filters = result.filters.map((filter) => filter === "key" ? "chave" : "período").join(" e ");
        feedback.textContent = `Formulário da SVRS acessível com o A1 cadastrado. Filtros identificados: ${filters}.`;
      } else if (result.state === "unidentified") {
        feedback.textContent = `O portal respondeu com HTTP ${result.httpStatus}. O formulário de download não foi identificado.`;
      } else {
        feedback.textContent = `Resposta inesperada do portal de download (HTTP ${result.httpStatus}).`;
      }
      if (result.challenge) feedback.textContent += " A página apresenta um desafio de verificação.";
      return;
    }
    feedback.textContent = `SVRS (${result.status}) — ${result.reason}`;
    if (mode === "open" && result.status === "111") {
      feedback.textContent = `MDF-e não encerrados encontrados: ${result.manifests.length}.`;
      mdfeRows = result.manifests.map(({ key, protocol }) => [key, "Não encerrado", protocol, ""]);
      mdfeCollectedKeys = [...new Set(result.manifests.map(({ key }) => key))].sort();
      mdfeExportKeys.disabled = mdfeCollectedKeys.length === 0;
    } else if (mode === "open" && result.status === "112") {
      feedback.textContent = "Nenhum MDF-e não encerrado encontrado.";
    } else if (mode === "situation" && result.status === "217") {
      feedback.textContent = `MDF-e não encontrado na base consultada (SVRS 217). ${result.reason || ""}`.trim();
    } else if (mode === "situation" && (result.protocol || result.events?.length)) {
      const events = (result.events || []).map((event) =>
        [event.description || `Evento ${event.type}`, event.protocol].filter(Boolean).join(" · "));
      mdfeRows = [[key, result.reason, result.protocol, events.join(" | ")]];
    }
    if (updatesTable) renderMdfeRows();
  } catch (error) {
    if (companyContext.selectedCompany?.id === company.id) feedback.textContent = error.message || "Não foi possível consultar MDF-e.";
  } finally {
    busy = false;
    for (const button of mdfeControls) button.disabled = false;
    render();
  }
}
refresh();
initializeCalendarSelector(companyContext);
initializeNoteSelector(companyContext);
initializeNfseQueries(companyContext, { onOpen: () => { mdfeQueries.hidden = true; companyPopover.close(); } });
initializeCteQueries(companyContext, { onOpen: () => companyPopover.close() });
