const { saveFiscalBatch, companyDirectory } = require("./fiscalDocumentStore");
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs/promises");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const AdmZip = require("adm-zip");
const { parseXml } = require("./localXml");
const { loadIcpRoot } = require("./sefazTls");
const { getUserDataDir } = require("./runtimePaths");
const { cteDirection, fiscalArchivePath } = require("./fiscalXmlPaths");

const endpoint = "https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx";
const namespace = "http://www.portalfiscal.inf.br/cte";
const service = `${namespace}/wsdl/CTeDistribuicaoDFe`;
const codes = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
const child = (node, name) => node?.children.find((item) => item.name === name);
const value = (node, name) => child(node, name)?.text.trim() || "";
const attribute = (node, name) => Object.values(node?.attributes || {}).find(({ local }) => local === name)?.value || "";
const nsu = (value) => /^\d{1,15}$/.test(value) ? value.padStart(15, "0") : null;
const zero = "000000000000000";
const svrs = "https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx";
const svsp = "https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx";
const stateEndpoints = {
  31: "https://cte.fazenda.mg.gov.br/cte/services/CTeConsultaV4",
  41: "https://cte.fazenda.pr.gov.br/cte4/CTeConsultaV4",
  50: "https://producao.cte.ms.gov.br/ws/CTeConsultaV4",
  51: "https://cte.sefaz.mt.gov.br/ctews2/services/CTeConsultaV4"
};
const svspCodes = new Set([14, 16, 26, 35]);
function consultationEndpoint(key) {
  const uf = Number(key.slice(0, 2));
  if (!Object.values(codes).includes(uf)) return null;
  return stateEndpoints[uf] || (svspCodes.has(uf) ? svsp : svrs);
}

function identifyCte(xml, document) {
  const root = parseXml(xml);
  const info = child(child(root, "cte"), "infcte");
  const ide = child(info, "ide");
  const protocol = child(child(root, "protcte"), "infprot");
  const key = attribute(info, "Id").replace(/^CTe/, "");
  if (root.name !== "cteproc" || !/^\d{20}57\d{22}$/.test(key) || value(ide, "mod") !== "57" ||
      value(protocol, "chcte") !== key || !["100", "150"].includes(value(protocol, "cstat"))) return null;
  const matches = (actor) => (value(actor, "cnpj") || value(actor, "cpf")) === document;
  const takerCode = value(child(ide, "toma3"), "toma");
  const referencedActor = ["rem", "exped", "receb", "dest"][Number(takerCode)];
  const taker = /^[0-3]$/.test(takerCode) ? child(info, referencedActor) : child(ide, "toma4") || child(info, "toma");
  const roles = [];
  if (matches(taker)) roles.push("tomadora");
  if (matches(child(info, "rem"))) roles.push("remetente");
  if (matches(child(info, "dest"))) roles.push("destinataria");
  return roles.length ? { key, roles, issuedAt: value(ide, "dhemi"), issuer: value(child(info, "emit"), "xnome") } : null;
}

function parseBatch(xml, document, requested = zero) {
  const envelope = parseXml(xml);
  const body = child(envelope, "body");
  const wrapper = child(body, "ctedistdfeinteresseresponse") || body;
  const response = child(child(wrapper, "ctedistdfeinteresseresult"), "retdistdfeint");
  const status = value(response, "cstat");
  if (!/^\d{3,4}$/.test(status)) throw new Error("Resposta inválida do Ambiente Nacional do CT-e.");
  const reason = value(response, "xmotivo");
  if (!["137", "138"].includes(status)) return { status, reason };
  const last = nsu(value(response, "ultnsu") || (status === "137" ? requested : ""));
  const max = nsu(value(response, "maxnsu") || (status === "137" ? last || "" : ""));
  if (!last || !max || last > max) throw new Error("O Ambiente Nacional retornou um NSU inválido.");
  const documents = [];
  let skipped = 0;
  for (const item of child(response, "lotedistdfeint")?.children || []) {
    if (item.name !== "doczip") continue;
    const id = nsu(attribute(item, "NSU"));
    if (!id || id > last) throw new Error("O lote contém um NSU inválido.");
    if (!/^procCTe_v[\d.]+\.xsd$/i.test(attribute(item, "schema"))) { skipped++; continue; }
    const buffer = gunzipSync(Buffer.from(item.text.replace(/\s/g, ""), "base64"), { maxOutputLength: 4 * 1024 * 1024 });
    const note = identifyCte(buffer.toString("utf8"), document);
    if (note) documents.push({ ...note, nsu: id, buffer });
    else skipped++;
  }
  return { status, reason, last, max, documents, skipped };
}

function buildBatchRequest(document, last, uf) {
  const tag = document.length === 14 ? "CNPJ" : "CPF";
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><cteDistDFeInteresse xmlns="${service}"><cteDadosMsg><distDFeInt xmlns="${namespace}" versao="1.00"><tpAmb>1</tpAmb><cUFAutor>${uf}</cUFAutor><${tag}>${document}</${tag}><distNSU><ultNSU>${last}</ultNSU></distNSU></distDFeInt></cteDadosMsg></cteDistDFeInteresse></soap:Body></soap:Envelope>`;
}

async function requestBatch({ document, last, certificate }) {
  const uf = codes[String(certificate.state || "").trim().toUpperCase()] || codes.BA;
  const body = buildBatchRequest(document, last, uf);
  return parseBatch(await requestCteSoap(endpoint, body, `${service}/cteDistDFeInteresse`, certificate), document, last);
}

function parseSituation(xml) {
  const envelope = parseXml(xml);
  const response = child(child(child(envelope, "body"), "cteconsultactresult"), "retconssitcte");
  const status = value(response, "cstat");
  if (!/^\d{3,4}$/.test(status)) throw new Error("Resposta inválida na consulta por chave de CT-e.");
  const protocol = value(child(child(response, "protcte"), "infprot"), "nprot");
  const events = response.children.filter(({ name }) => name === "proceventocte").map((node) => {
    const request = child(child(node, "eventocte"), "infevento");
    const result = child(child(node, "reteventocte"), "infevento");
    return { type: value(request, "tpevento") || value(result, "tpevento"), description: value(child(request, "detevento"), "descevento") || value(result, "xevento"), protocol: value(result, "nprot") };
  });
  return { status, reason: value(response, "xmotivo"), protocol, events };
}

async function requestSituation({ key, certificate }) {
  const ws = `${namespace}/wsdl/CTeConsultaV4`;
  const body = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><cteDadosMsg xmlns="${ws}"><consSitCTe xmlns="${namespace}" versao="4.00"><tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chCTe>${key}</chCTe></consSitCTe></cteDadosMsg></soap:Body></soap:Envelope>`;
  return parseSituation(await requestCteSoap(consultationEndpoint(key), body, `${ws}/cteConsultaCT`, certificate));
}

async function requestCteSoap(url, body, action, certificate) {
  const ca = [...(tls.getCACertificates?.() || tls.rootCertificates), await loadIcpRoot()];
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "POST", pfx: certificate.pfx, passphrase: certificate.passphrase, ca, agent: false,
      rejectUnauthorized: true, minVersion: "TLSv1.2", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`, "Content-Length": Buffer.byteLength(body) }
    }, async (response) => {
      try {
        if (response.statusCode !== 200) {
          response.resume();
          throw Object.assign(new Error("Falha HTTP no serviço de CT-e."), { httpStatus: response.statusCode });
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 24 * 1024 * 1024) throw new Error("O lote CT-e excedeu o tamanho esperado.");
          chunks.push(chunk);
        }
        resolve(Buffer.concat(chunks, size).toString("utf8"));
      } catch (error) { reject(error); }
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function recordAccess(entry) {
  const directory = path.join(getUserDataDir(), "diagnostics");
  await fs.mkdir(directory, { recursive: true });
  await fs.appendFile(path.join(directory, "cte-access.jsonl"), JSON.stringify(entry) + "\n");
}

function installCteRoutes(app, options = {}) {
  const { query = requestBatch, situation = requestSituation, root = path.join(getUserDataDir(), "cte-distribution"), record = recordAccess,
    archiveRoot = options.root ? root : undefined } = options;
  async function xmlPath(document, item, directory) {
    const file = path.join(companyDirectory(document, "cte", archiveRoot), item.key + ".xml");
    try { await fs.access(file); return file; }
    catch (error) { if (error.code !== "ENOENT") throw error; return path.join(directory, `${nsu(item.nsu)}.xml`); }
  }
  const active = new Set();
  async function readState(directory) {
    try { return JSON.parse(await fs.readFile(path.join(directory, "state.json"), "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { last: zero, nextAllowedAt: null, documents: [] };
    }
  }
  async function saveState(directory, state) {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "state.json");
    await fs.writeFile(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
    await fs.rename(file + ".tmp", file);
  }
  const route = (handler) => async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const catalog = app.locals.companyCatalog;
      const { companies } = await catalog.list();
      const company = companies.find(({ id }) => id === req.params.id);
      if (!company) return res.status(404).json({ error: "Empresa não encontrada." });
      const document = String(company.cnpj || company.document || "").replace(/[.\/\-\s]/g, "");
      if (!/^(?:\d{11}|\d{14})$/.test(document)) return res.status(400).json({ error: "Confira o CPF ou CNPJ cadastrado." });
      await handler({ req, res, company, catalog, document, directory: path.join(root, document) });
    } catch (error) {
      const message = error.httpStatus ? `O serviço de CT-e retornou HTTP ${error.httpStatus}.` :
        error.status ? error.message : "Não foi possível concluir a operação de CT-e.";
      res.status(error.status || 502).json({ error: message, code: error.code, httpStatus: error.httpStatus });
    }
  };
  const base = "/api/companies/:id/cte";
  async function loadCertificate(company, catalog) {
    let certificate;
    try { certificate = await catalog.loadCertificate(company.id, { encryption: app.locals.companyCredentialEncryption }); }
    catch { throw Object.assign(new Error("Não foi possível abrir o A1 cadastrado para esta empresa."), { status: 422 }); }
    if (!certificate) throw Object.assign(new Error("Vincule um certificado A1 no cadastro da empresa."), { status: 422 });
    return certificate;
  }
  app.get(base, route(async ({ res, directory }) => res.json(await readState(directory))));
  app.get(base + "/archive", route(async ({ req, res, directory, document }) => {
    const { month = "", role = "" } = req.query;
    if (typeof month !== "string" || (month && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) ||
        !["", "tomadora", "remetente", "destinataria"].includes(role)) {
      return res.status(400).json({ error: "Informe filtros válidos para o lote de CT-e." });
    }
    const { documents } = await readState(directory);
    const selected = documents.filter((item) => (!month || item.issuedAt?.slice(0, 7) === month) && (!role || item.roles.includes(role)));
    if (!selected.length) return res.status(404).json({ error: "Nenhum XML coletado corresponde aos filtros." });
    const zip = new AdmZip();
    for (const item of new Map(selected.map((entry) => [entry.key, entry])).values()) {
      const id = nsu(item.nsu);
      if (!id || !/^\d{44}$/.test(item.key)) throw new Error("Registro local de CT-e inválido.");
      const buffer = await fs.readFile(await xmlPath(document, item, directory));
      zip.addFile(fiscalArchivePath({ document, type: "cte", key: item.key, date: item.issuedAt, direction: cteDirection(item.roles) }), buffer);
    }
    const name = ["cte", month, role].filter(Boolean).join("-") + ".zip";
    res.attachment(name).type("application/zip").send(zip.toBuffer());
  }));
  app.post(base + "/situation", route(async ({ req, res, directory, company, catalog }) => {
    const key = typeof req.body?.key === "string" ? req.body.key.replace(/\s/g, "") : "";
    if (!/^\d{20}(?:57|67|64)\d{22}$/.test(key) || !consultationEndpoint(key)) {
      return res.status(400).json({ error: "Informe uma chave CT-e de 44 dígitos com UF e modelo válidos." });
    }
    const certificate = await loadCertificate(company, catalog);
    try {
      const result = await situation({ key, certificate });
      const cached = (await readState(directory)).documents.find((item) => item.key === key);
      res.json({ ...result, key, nsu: cached?.nsu || null });
    } finally { certificate.pfx.fill(0); }
  }));
  app.get(base + "/:nsu/xml", route(async ({ req, res, directory, document }) => {
    const id = nsu(req.params.nsu);
    const item = (await readState(directory)).documents.find((entry) => entry.nsu === id);
    if (!item) return res.status(404).json({ error: "XML de CT-e não localizado." });
    res.download(await xmlPath(document, item, directory), `${item.key}-cte.xml`);
  }));
  app.post(base, route(async ({ res, company, catalog, document, directory }) => {
    if (active.has(document)) return res.status(409).json({ error: "Já existe uma consulta de CT-e para este cadastro." });
    active.add(document);
    let certificate;
    const audit = { at: new Date().toISOString(), companyId: company.id, result: "failed" };
    try {
      const state = await readState(directory);
      if (Date.parse(state.nextAllowedAt) > Date.now()) {
        audit.result = "waiting";
        return res.json({ ...state, waiting: true });
      }
      audit.result = "certificate_unavailable";
      certificate = await loadCertificate(company, catalog);
      audit.result = "request_failed";
      const batch = await query({ document, last: state.last, certificate });
      audit.status = batch.status;
      if (!["137", "138"].includes(batch.status)) {
        audit.result = "rejected";
        if (batch.status === "656") {
          state.nextAllowedAt = new Date(Date.now() + 3600000).toISOString();
          await saveState(directory, state);
        }
        return res.status(502).json({ error: `Ambiente Nacional (${batch.status}) — ${batch.reason}`, nextAllowedAt: state.nextAllowedAt });
      }
      if (batch.last < state.last || (batch.status === "138" && batch.last === state.last && batch.last < batch.max)) throw new Error("NSU sem avanço.");
      await fs.mkdir(directory, { recursive: true });
      const stored = await saveFiscalBatch({ company: document, type: "cte", notes: batch.documents, root: archiveRoot, legacyDirectories: [directory] });
      const documents = new Map(state.documents.map((item) => [item.key, item]));
      for (const { buffer, ...item } of batch.documents) {
        documents.set(item.key, item);
      }
      const result = { last: batch.last, nextAllowedAt: batch.status === "137" || batch.last === batch.max ? new Date(Date.now() + 3600000).toISOString() : null, documents: [...documents.values()] };
      await saveState(directory, result);
      audit.result = batch.status === "137" ? "empty" : "collected";
      audit.added = stored.savedCount;
      res.json({ ...result, newDocuments: stored.documents.map(({ buffer, ...item }) => item), status: batch.status, added: audit.added, skipped: batch.skipped, duplicateCount: stored.duplicateCount, hasMore: batch.status === "138" && batch.last < batch.max });
    } catch (error) {
      if (error.code) audit.errorCode = error.code;
      if (error.httpStatus) audit.httpStatus = error.httpStatus;
      throw error;
    } finally {
      certificate?.pfx.fill(0);
      active.delete(document);
      try { await record(audit); }
      catch { console.warn("Não foi possível gravar o diagnóstico de CT-e."); }
    }
  }));
}

module.exports = { installCteRoutes, identifyCte, buildBatchRequest, parseBatch, parseSituation, consultationEndpoint };
