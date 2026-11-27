import { fiscalBatches } from "./fiscal-batches.js";
export function initializeCteQueries(companyContext, { onOpen }) {
  const panel = document.querySelector("#cteQueries");
  const button = document.querySelector("#cteCollect");
  const role = document.querySelector("#cteRole");
  const month = document.querySelector("#cteMonth");
  const downloadBatch = document.querySelector("#cteDownloadBatch");
  const body = document.querySelector("#cteResults");
  const message = document.querySelector("#cteMessage");
  const labels = { tomadora: "Tomadora", remetente: "Remetente", destinataria: "Destinatária" };
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bahia" });
  let companyId;
  let documents = [];
  let requestVersion = 0;
  let busy = false;
  let exporting = false;
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const visibleDocuments = () => documents.filter((item) =>
    (!role.value || item.roles.includes(role.value)) && (!month.value || item.issuedAt?.slice(0, 7) === month.value));

  function renderMonths() {
    const selected = month.value;
    const months = [...new Set(documents.map((item) => item.issuedAt?.slice(0, 7))
      .filter((value) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)))].sort().reverse();
    month.replaceChildren(new Option("Todos os meses", ""),
      ...months.map((value) => new Option(monthLabel.format(new Date(`${value}-01T00:00:00Z`)), value)));
    if (months.includes(selected)) month.value = selected;
  }

  function renderRows() {
    body.replaceChildren();
    const visible = visibleDocuments();
    downloadBatch.disabled = exporting || !visible.length;
    for (const item of visible) {
      const row = body.insertRow();
      const timestamp = Date.parse(item.issuedAt);
      for (const text of [item.key, item.issuer, Number.isFinite(timestamp) ? date.format(timestamp) : "", item.roles.map((entry) => labels[entry]).join(", ")]) {
        row.insertCell().textContent = text || "—";
      }
      const link = document.createElement("a");
      link.href = `/api/companies/${encodeURIComponent(companyId)}/cte/${encodeURIComponent(item.nsu)}/xml`;
      link.download = `${item.key}-cte.xml`;
      link.textContent = "Baixar XML";
      row.insertCell().append(link);
    }
    if (!visible.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 5;
      cell.textContent = documents.length ? "Nenhum documento corresponde aos filtros." : "Nenhum CT-e coletado.";
    }
  }
  async function request(collect) {
    if (!companyId || busy) return;
    const version = ++requestVersion;
    busy = true;
    button.disabled = true;
    message.textContent = collect ? "Consultando o Ambiente Nacional do CT-e…" : "Carregando CT-e coletados…";
    try {
      let added = 0;
      if (collect) documents = [];
      for await (const { data } of fiscalBatches({
        cursor: "initial",
        isActive: () => version === requestVersion,
        request: async () => {
          const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/cte`, { method: collect ? "POST" : "GET", cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          return data;
        },
        next: (data) => collect && data.hasMore && !data.waiting && !data.nextAllowedAt ? data.last : null
      })) {
        added += data.added || 0;
        documents = collect && !data.waiting ? [...documents, ...(data.newDocuments || data.documents)] : data.documents;
        renderMonths();
        const next = Date.parse(data.nextAllowedAt);
        const waiting = next > Date.now() ? ` Próxima consulta disponível a partir de ${date.format(next)}.` : "";
        const certificate = companyContext.selectedCompany?.certificate;
        const access = !certificate ? " Cadastre um A1 para consultar novos CT-e." :
          Date.parse(certificate.validTo) <= Date.now() ? " O A1 cadastrado está vencido." : "";
        const result = collect && !data.waiting ? `${added} CT-e novo(s) nos papéis exibidos.` :
          `${documents.length} CT-e coletado(s).`;
        message.textContent = result + waiting + access;
        renderRows();
      }
    } catch (error) {
      if (version === requestVersion) message.textContent = error.message || "Não foi possível consultar CT-e.";
    } finally {
      if (version === requestVersion) { busy = false; button.disabled = false; }
    }
  }
  companyContext.subscribe(() => {
    const company = companyContext.selectedCompany;
    if (company?.id === companyId) return;
    companyId = company?.id;
    requestVersion++;
    busy = false;
    documents = [];
    role.value = "";
    month.value = "";
    renderMonths();
    message.textContent = "";
    document.querySelector("#cteCompany").textContent = company?.legalName || "";
    renderRows();
    if (!company) panel.hidden = true;
    if (!panel.hidden) request(false);
  });
  role.addEventListener("change", renderRows);
  month.addEventListener("change", renderRows);
  downloadBatch.addEventListener("click", async () => {
    const company = companyId;
    const filters = { month: month.value, role: role.value };
    if (!company || !visibleDocuments().length || exporting) return;
    exporting = true;
    downloadBatch.disabled = true;
    try {
      const query = new URLSearchParams(filters);
      const response = await fetch(`/api/companies/${encodeURIComponent(company)}/cte/archive?${query}`);
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = ["cte", filters.month, filters.role].filter(Boolean).join("-") + ".zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      if (company === companyId) message.textContent = error.message || "Não foi possível baixar o lote de XMLs.";
    } finally {
      exporting = false;
      downloadBatch.disabled = !visibleDocuments().length;
    }
  });
  button.addEventListener("click", () => request(true));
  document.addEventListener("company-module:request", ({ detail }) => {
    if (detail.module === "mdf" || detail.module === "nfse") panel.hidden = true;
    if (detail.module !== "cte") return;
    panel.hidden = false;
    onOpen();
    document.querySelector("#cteTitle").focus();
    request(false);
  });
}
