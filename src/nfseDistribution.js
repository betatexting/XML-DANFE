const { saveFiscalBatch } = require("./fiscalDocumentStore");
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs/promises");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { loadIcpRoot } = require("./sefazTls");
const { validateDocument } = require("../public/document-validation");
const { parseXml } = require("./localXml");
const { getUserDataDir, getFiscalDownloadsDir } = require("./runtimePaths");

const messages = {
  E2210: "O ADN rejeitou o certificado de transmissão.",
  E2211: "O ADN informou que o certificado foi revogado.",
  E2212: "O ADN rejeitou a cadeia de certificação.",
  E2213: "O ADN informou que o certificado expirou.",
  E2214: "O ADN não conseguiu verificar a revogação do certificado.",
  E2245: "O ADN não reconheceu uma procuração válida para este CNPJ e este procurador."
};

async function queryNfse({ cnpj, nsu, certificate }) {
  const url = new URL(`https://adn.nfse.gov.br/contribuintes/DFe/${nsu}`);
  url.search = new URLSearchParams({ cnpjConsulta: cnpj, lote: "true" });
  const ca = [...(tls.getCACertificates?.() || tls.rootCertificates), await loadIcpRoot()];
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      pfx: certificate.pfx, passphrase: certificate.passphrase, ca, agent: false,
      rejectUnauthorized: true, minVersion: "TLSv1.2", signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" }
    }, async (response) => {
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) throw new Error("Resposta do ADN acima do tamanho esperado.");
          chunks.push(chunk);
        }
        resolve({ httpStatus: response.statusCode, data: JSON.parse(Buffer.concat(chunks, size).toString("utf8")) });
      } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function summarizeNfse({ httpStatus, data }, nsu) {
  const codes = (Array.isArray(data?.Erros) ? data.Erros : []).map((item) => item?.Codigo).filter((code) => /^E\d+$/.test(code));
  if (httpStatus === 404 && codes.some((code) => code === "E2220" || code === "E2230")) {
    return { documents: [], nextNsu: nsu, authorization: data.TipoConsulta || null };
  }
  if (httpStatus !== 200 || data?.StatusProcessamento === "REJEICAO" || !Array.isArray(data?.LoteDFe)) {
    const code = codes[0];
    throw Object.assign(new Error(messages[code] || "O ADN não aceitou a consulta de NFS-e."), { status: 502, code });
  }
  let nextNsu = nsu;
  const documents = data.LoteDFe.map((item) => {
    const number = String(item.NSU ?? "");
    if (!/^\d{1,15}$/.test(number)) throw new Error("O ADN retornou um NSU inválido.");
    if (BigInt(number) > BigInt(nextNsu)) nextNsu = number;
    return {
      nsu: number,
      key: String(item.ChaveAcesso || "").slice(0, 80),
      type: String(item.TipoDocumento || "").slice(0, 50),
      event: String(item.TipoEvento || "").slice(0, 80)
    };
  });
  return { documents, nextNsu, authorization: data.TipoConsulta || null };
}

function unpackNote(item) {
  const encoded = typeof item.ArquivoXml === "string" ? item.ArquivoXml.trim() : "";
  const raw = encoded.startsWith("<") ? Buffer.from(encoded) : Buffer.from(encoded, "base64");
  const buffer = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: 4 * 1024 * 1024 }) : raw;
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error("XML de NFS-e inválido.");
  const root = parseXml(buffer.toString("utf8"));
  const info = root.children.find(({ name }) => name === "infnfse");
  const key = Object.values(info?.attributes || {}).find(({ local }) => local === "Id")?.value.replace(/^NFS/i, "");
  if (root.name !== "nfse" || !/^\d{50}$/.test(key || "") || key !== String(item.ChaveAcesso)) throw new Error("A chave do XML não corresponde à NFS-e retornada.");
  return { key, buffer };
}

async function readCursor(directory) {
  try {
    const { nsu } = JSON.parse(await fs.readFile(path.join(directory, "cursor.json"), "utf8"));
    if (typeof nsu !== "string" || !/^\d{1,15}$/.test(nsu)) throw new Error("NSU salvo inválido.");
    return nsu;
  } catch (error) {
    if (error.code === "ENOENT") return "0";
    throw error;
  }
}

function installNfseRoutes(app, options = {}) {
  const { query = queryNfse, root = path.join(getUserDataDir(), "nfse-distribution"),
    archiveRoot = options.root ? root : getFiscalDownloadsDir() } = options;
  const active = new Set();
  async function findCompany(req) {
    const { companies } = await app.locals.companyCatalog.list();
    const company = companies.find(({ id }) => id === req.params.id);
    if (!company) return { status: 404, error: "Empresa não encontrada." };
    const validation = validateDocument("cnpj", company.cnpj || company.document || "");
    if (!validation.valid || !/^\d{14}$/.test(validation.number)) return { status: 400, error: "Informe um CNPJ válido no cadastro da empresa." };
    return { companies, company, cnpj: validation.number, directory: path.join(root, validation.number) };
  }
  app.get("/api/companies/:id/nfse/distribution", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const target = await findCompany(req);
      if (target.error) return res.status(target.status).json({ error: target.error });
      res.json({ nsu: await readCursor(target.directory) });
    } catch { res.status(500).json({ error: "Não foi possível ler o NSU salvo." }); }
  });
  app.post("/api/companies/:id/nfse/distribution", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const catalog = app.locals.companyCatalog;
    let certificate;
    let locked;
    try {
      const target = await findCompany(req);
      if (target.error) return res.status(target.status).json({ error: target.error });
      const { companies, company, cnpj, directory } = target;
      const nsu = req.body?.nsu;
      if (typeof nsu !== "string" || !/^\d{1,15}$/.test(nsu)) return res.status(400).json({ error: "Informe um NSU de até 15 dígitos." });
      const proxyId = req.body?.proxyId;
      const holder = proxyId ? companies.find(({ id, nfseProxy }) => id === proxyId && nfseProxy === true) : company;
      if (!holder) return res.status(400).json({ error: "Selecione um procurador cadastrado." });
      if (!holder.certificate) return res.status(422).json({ error: "O titular selecionado não tem certificado A1 cadastrado." });
      if (Date.parse(holder.certificate.validTo) <= Date.now()) return res.status(422).json({ error: "O certificado A1 selecionado expirou." });
      if (active.has(cnpj)) return res.status(409).json({ error: "Já existe uma consulta de NFS-e para esta empresa." });
      active.add(cnpj);
      locked = cnpj;
      try { certificate = await catalog.loadCertificate(holder.id, { encryption: app.locals.companyCredentialEncryption }); }
      catch { return res.status(422).json({ error: "Não foi possível abrir o certificado A1 selecionado." }); }
      if (!certificate) return res.status(422).json({ error: "Certificado A1 indisponível." });
      const response = await query({ cnpj, nsu, certificate });
      const result = summarizeNfse(response, nsu);
      const receivedCount = result.documents.length;
      let notes;
      try {
        notes = (response.data.LoteDFe || []).filter((item) => String(item.TipoDocumento).toUpperCase() === "NFSE").map(unpackNote);
      } catch {
        return res.status(502).json({ error: "O ADN retornou uma NFS-e sem XML válido. O último NSU salvo foi preservado." });
      }
      let savedNsu = await readCursor(directory);
      const destination = archiveRoot === root ? directory : path.join(archiveRoot, cnpj, "nfse");
      const stored = await saveFiscalBatch({ company: cnpj, type: "nfse", notes, directory: destination, legacyDirectories: [directory] });
      if (notes.length || (BigInt(nsu) <= BigInt(savedNsu) && BigInt(result.nextNsu) > BigInt(savedNsu))) {
        await fs.mkdir(directory, { recursive: true });
        if (BigInt(nsu) <= BigInt(savedNsu) && BigInt(result.nextNsu) > BigInt(savedNsu)) {
          const file = path.join(directory, "cursor.json");
          await fs.writeFile(file + ".tmp", JSON.stringify({ nsu: result.nextNsu }), { mode: 0o600 });
          await fs.rename(file + ".tmp", file);
          savedNsu = result.nextNsu;
        }
      }
      const newKeys = new Set(stored.documents.map(({ key }) => key));
      res.json({ ...result, documents: result.documents.filter((doc) => doc.type.toUpperCase() === "NFSE" && newKeys.has(doc.key)),
        receivedCount, savedNsu, savedCount: stored.savedCount, duplicateCount: stored.duplicateCount, directory: destination });
    } catch (error) {
      res.status(502).json({ error: error.status === 502 ? error.message : "Não foi possível consultar o ADN da NFS-e.", code: error.code });
    } finally {
      certificate?.pfx.fill(0);
      if (locked) active.delete(locked);
    }
  });
}

module.exports = { installNfseRoutes, summarizeNfse, unpackNote };
