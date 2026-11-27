import { fiscalBatches } from "./fiscal-batches.js";
import { downloadFiscalXml } from "./fiscal-xml-download.js";

export function initializeNfseQueries(companyContext, { onOpen }) {
  const panel = document.querySelector("#nfseQueries");
  const form = document.querySelector("#nfseForm");
  const auth = document.querySelector("#nfseAuth");
  const proxy = document.querySelector("#nfseProxy");
  const nsu = document.querySelector("#nfseNsu");
  const next = document.querySelector("#nfseNext");
  const message = document.querySelector("#nfseMessage");
  const results = document.querySelector("#nfseResults");
  const submit = form.querySelector("button[type=submit]");
  const archiveForm = document.querySelector("#nfseArchiveForm");
  const archiveMonth = document.querySelector("#nfseArchiveMonth");
  const archiveMessage = document.querySelector("#nfseArchiveMessage");
  const certificateState = (company) => {
    if (!company?.certificate) return "missing";
    const expires = Date.parse(company.certificate.validTo);
    return Number.isFinite(expires) && expires > Date.now() ? "valid" : "expired";
  };
  const statusLabels = { missing: "Sem certificado cadastrado", expired: "Certificado expirado", valid: "Certificado cadastrado" };
  let currentId;
  let busy = false;
  let continuation = null;

  function renderControls() {
    const delegated = auth.value === "proxy";
    document.querySelector("#nfseProxyField").hidden = !delegated;
    proxy.disabled = busy || !delegated;
    auth.disabled = busy;
    nsu.disabled = busy;
    submit.disabled = busy || (delegated ? !proxy.value : certificateState(companyContext.selectedCompany) !== "valid");
    next.disabled = submit.disabled;
    next.hidden = !continuation;
  }

  function resetResults() {
    continuation = null;
    results.replaceChildren();
    message.textContent = "";
  }
  async function loadCursor() {
    const company = companyContext.selectedCompany;
    if (!company) return;
    const initial = nsu.value;
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}/nfse/distribution`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (!busy && company.id === currentId && nsu.value === initial && /^\d{1,15}$/.test(data.nsu)) nsu.value = data.nsu;
    } catch { /* The field remains editable when the local cursor is unavailable. */ }
  }

  companyContext.subscribe(({ companies }) => {
    const company = companyContext.selectedCompany;
    const state = certificateState(company);
    const selectedProxy = proxy.value;
    if (company?.id !== currentId) {
      currentId = company?.id;
      auth.value = state === "valid" ? "own" : "proxy";
      nsu.value = "0";
      archiveMonth.value = "";
      archiveMessage.textContent = "";
      resetResults();
      if (!panel.hidden) loadCursor();
    }
    if (!company) panel.hidden = true;
    document.querySelector("#nfseCompany").textContent = company?.legalName || "";
    document.querySelector("#nfseCertificateStatus").textContent = statusLabels[state];
    const expiry = Date.parse(company?.certificate?.validTo);
    document.querySelector("#nfseCertificateExpiry").textContent = Number.isFinite(expiry)
      ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia" }).format(expiry) : "—";
    const available = companies.filter((entry) => entry.nfseProxy && entry.id !== company?.id && certificateState(entry) === "valid");
    const placeholder = new Option(available.length ? "Selecione um procurador" : "Nenhum procurador com A1 válido", "");
    proxy.replaceChildren(placeholder, ...available.map((entry) => new Option(entry.legalName, entry.id)));
    proxy.value = available.some((entry) => entry.id === selectedProxy) ? selectedProxy : "";
    renderControls();
  });
  for (const control of [auth, proxy, nsu]) control.addEventListener("input", () => {
    resetResults();
    renderControls();
  });
  document.querySelector("#nfseRegisterProxy").addEventListener("click", () =>
    document.dispatchEvent(new CustomEvent("company:create-request", { cancelable: true })));
  document.addEventListener("company-module:request", ({ detail }) => {
    if (detail.module === "mdf" || detail.module === "cte") panel.hidden = true;
    if (detail.module !== "nfse") return;
    panel.hidden = false;
    onOpen();
    loadCursor();
    document.querySelector("#nfseTitle").focus();
  });

  async function query(start, append) {
    const company = companyContext.selectedCompany;
    if (!company || submit.disabled) return;
    const proxyId = auth.value === "proxy" ? proxy.value : undefined;
    if (!append) resetResults();
    busy = true;
    renderControls();
    message.textContent = "Consultando o Ambiente de Dados Nacional…";
    let saved = 0, duplicates = 0, batches = 0;
    const nextCursor = (data, cursor) => (data.receivedCount ?? data.documents.length) > 0 && BigInt(data.nextNsu) > BigInt(cursor) ? data.nextNsu : null;
    try {
      for await (const { data, cursor } of fiscalBatches({
        cursor: start,
        isActive: () => companyContext.selectedCompany?.id === company.id,
        request: async (cursor) => {
          const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}/nfse/distribution`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nsu: cursor, proxyId })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.code ? `${data.error} (${data.code})` : data.error);
          return data;
        },
        next: nextCursor
      })) {
        saved += data.savedCount ?? data.documents.length;
        duplicates += data.duplicateCount || 0;
        batches++;
        for (const document of data.documents) {
          const row = results.insertRow();
          for (const value of [document.nsu, document.type, document.key, document.event]) row.insertCell().textContent = value || "—";
        }
        continuation = nextCursor(data, cursor);
        nsu.value = data.nextNsu;
        message.textContent = `${saved} nota(s) nova(s) · ${duplicates} já salva(s) · ${batches} lote(s).`;
      }
    } catch (error) {
      if (companyContext.selectedCompany?.id === company.id) message.textContent = `${saved} nota(s) salva(s) · ${duplicates} já existente(s). ${error.message || "Falha na consulta de NFS-e."} O progresso dos lotes concluídos foi preservado.`;
    } finally {
      busy = false;
      renderControls();
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    query(nsu.value, false);
  });
  next.addEventListener("click", () => {
    if (continuation) query(continuation, true);
  });
  archiveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const company = companyContext.selectedCompany;
    if (!company) return;
    const button = archiveForm.querySelector("button");
    button.disabled = true;
    archiveMessage.textContent = "Preparando o ZIP dos XMLs salvos…";
    try {
      await downloadFiscalXml(company.id, "nfse", archiveMonth.value);
      if (company.id === currentId) archiveMessage.textContent = "ZIP disponível para salvar.";
    } catch (error) {
      if (company.id === currentId) archiveMessage.textContent = error.message;
    } finally { button.disabled = false; }
  });
}
