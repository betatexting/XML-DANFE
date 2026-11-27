const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { validateDocument } = require("../public/document-validation");
const { protectCompanyCertificate, restoreCompanyCertificate, publicCertificate } = require("./companyCertificate");
const { getUserDataDir } = require("./runtimePaths");

function createCompanyCatalog({ filePath = path.join(getUserDataDir(), "companies.json") } = {}) {
  let queue = Promise.resolve();
  async function read() {
    let data;
    try { data = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return { version: 1, companies: [], selectedCompanyId: null }; throw error; }
    if (!Array.isArray(data.companies)) throw new Error("Cadastro de empresas invalido.");
    const ids = new Set();
    for (const company of data.companies) {
      if (typeof company.id !== "string" || !company.id || company.id.length > 80 || ids.has(company.id) || typeof company.legalName !== "string" || !company.legalName.trim() || company.legalName.length > 200) throw new Error("Cadastro de empresas invalido.");
      ids.add(company.id);
    }
    return data;
  }
  function snapshot(data) {
    return {
      companies: data.companies.map(({ id, legalName, cnpj, code, documentType, document, stateRegistration, certificate, lastCompletedQueryAt, nfseProxy }) => ({ id, legalName, ...(typeof cnpj === "string" ? { cnpj } : {}), ...(documentType ? { code, documentType, document, stateRegistration } : {}), ...(certificate ? { certificate: publicCertificate(certificate) } : {}), ...(nfseProxy === true ? { nfseProxy: true } : {}), ...(typeof lastCompletedQueryAt === "string" && Number.isFinite(Date.parse(lastCompletedQueryAt)) ? { lastCompletedQueryAt } : {}) })),
      selectedCompanyId: data.companies.some((company) => company.id === data.selectedCompanyId) ? data.selectedCompanyId : null
    };
  }
  return {
    async list() { return snapshot(await read()); },
    async loadPortalCredentials(id, { encryption } = {}) {
      const company = (await read()).companies.find((company) => company.id === id);
      if (!company?.portalCredentials || !encryption?.isEncryptionAvailable()) throw Object.assign(new Error("As credenciais SEFAZ não estão disponíveis. Confira o cadastro no aplicativo desktop."), { code: "credentials_unavailable" });
      let credentials;
      try { credentials = JSON.parse(encryption.decryptString(Buffer.from(company.portalCredentials, "base64"))); }
      catch { throw Object.assign(new Error("Não foi possível abrir as credenciais SEFAZ salvas neste perfil Windows."), { code: "credentials_unavailable" }); }
      if (typeof credentials.login !== "string" || !credentials.login || typeof credentials.password !== "string" || !credentials.password) throw Object.assign(new Error("Confira o login e a senha SEFAZ no cadastro."), { code: "credentials_unavailable" });
      return credentials;
    },
    async loadCertificate(id, { encryption } = {}) {
      const company = (await read()).companies.find((company) => company.id === id);
      if (!company) throw Object.assign(new Error("Empresa nao cadastrada."), { status: 400 });
      return restoreCompanyCertificate(company.certificate, encryption);
    },
    create(input, { encryption, certificate } = {}) {
      const task = queue.then(async () => {
        const text = (name, max, required = false) => {
          const value = typeof input?.[name] === "string" ? input[name].trim() : "";
          if ((required && !value) || value.length > max) throw Object.assign(new Error("Confira os campos obrigatorios e o tamanho dos dados."), { status: 400 });
          return value;
        };
        const legalName = text("legalName", 200, true), code = text("code", 80), stateRegistration = text("stateRegistration", 80);
        const documentType = text("documentType", 8, true);
        const validation = validateDocument(documentType, text("document", 32, true));
        if (!validation.valid) throw Object.assign(new Error(validation.message), { status: 400 });
        const document = validation.number;
        const nfseProxy = input?.nfseProxy === true;
        const login = text("portalLogin", 200, !nfseProxy);
        const password = input?.portalPassword;
        if ((!nfseProxy || login || password) && (!login || typeof password !== "string" || !password.trim() || password.length > 512)) throw Object.assign(new Error("Informe o login e a senha do portal SEFAZ."), { status: 400 });
        if (nfseProxy && !certificate) throw Object.assign(new Error("Importe o certificado A1 do procurador."), { status: 400 });
        if (!encryption?.isEncryptionAvailable()) throw new Error("A protecao de senhas do Windows nao esta disponivel. O cadastro nao foi salvo.");
        const data = await read();
        if (data.companies.some((company) => (company.documentType || (company.cnpj ? "cnpj" : "")) === documentType && String(company.document || company.cnpj || "").replace(/[.\/\-\s]/g, "").toUpperCase() === document)) throw Object.assign(new Error("Ja existe uma empresa cadastrada com esse documento."), { status: 409 });
        const company = { id: randomUUID(), code, legalName, documentType, document, stateRegistration, ...(documentType === "cnpj" ? { cnpj: document } : {}) };
        if (login) company.portalCredentials = encryption.encryptString(JSON.stringify({ login, password })).toString("base64");
        if (nfseProxy) company.nfseProxy = true;
        if (certificate) company.certificate = protectCompanyCertificate(certificate, encryption);
        data.companies.push(company);
        if (!nfseProxy || login) data.selectedCompanyId = company.id;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath + ".tmp", JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
        await fs.rename(filePath + ".tmp", filePath);
        return { companyId: company.id, ...snapshot(data) };
      });
      queue = task.catch(() => {});
      return task;
    },
    // Called by the automatic query processor only after a successful completion.
    // Opening the calendar or requesting a search must never advance this marker.
    recordQueryCompletion(id, completedAt = new Date().toISOString()) {
      const task = queue.then(async () => {
        const timestamp = typeof completedAt === "string" ? Date.parse(completedAt) : NaN;
        if (!Number.isFinite(timestamp) || timestamp > Date.now()) throw new Error("Data de conclusao invalida.");
        const data = await read();
        const company = data.companies.find((company) => company.id === id);
        if (!company) throw Object.assign(new Error("Empresa nao cadastrada."), { status: 400 });
        if (!Number.isFinite(Date.parse(company.lastCompletedQueryAt)) || timestamp > Date.parse(company.lastCompletedQueryAt)) {
          company.lastCompletedQueryAt = new Date(timestamp).toISOString();
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath + ".tmp", JSON.stringify(data, null, 2), "utf8");
          await fs.rename(filePath + ".tmp", filePath);
        }
        return snapshot(data);
      });
      queue = task.catch(() => {});
      return task;
    },
    select(id) {
      const task = queue.then(async () => {
        const data = await read();
        if (id !== null && !data.companies.some((company) => company.id === id)) throw Object.assign(new Error("Selecione uma empresa cadastrada."), { status: 400 });
        data.selectedCompanyId = id;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath + ".tmp", JSON.stringify(data, null, 2), "utf8");
        await fs.rename(filePath + ".tmp", filePath);
        return snapshot(data);
      });
      queue = task.catch(() => {});
      return task;
    }
  };
}

function installCompanyRoutes(app) {
  app.locals.companyCatalog ||= createCompanyCatalog();
  app.get("/api/companies", async (_req, res) => {
    try { res.json(await app.locals.companyCatalog.list()); }
    catch { res.status(500).json({ error: "Nao foi possivel carregar as empresas cadastradas." }); }
  });
  app.post("/api/companies/selection", async (req, res) => {
    try {
      if (!req.is("application/json")) return res.status(415).json({ error: "Envie a selecao em JSON." });
      res.json(await app.locals.companyCatalog.select(req.body?.companyId));
    } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Nao foi possivel salvar a empresa selecionada." }); }
  });
}

module.exports = { createCompanyCatalog, installCompanyRoutes };
