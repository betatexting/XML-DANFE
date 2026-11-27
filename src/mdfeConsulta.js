const { saveFiscalBatch, findFiscalDocument } = require("./fiscalDocumentStore");
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseXml } = require("./localXml");
const { loadIcpRoot } = require("./sefazTls");
const { getUserDataDir } = require("./runtimePaths");
const { PORTAL_URL: downloadPortal, downloadOwnManifest, validateManifestXml } = require("./mdfeDownload");

const namespace = "http://www.portalfiscal.inf.br/mdfe";
const downloadErrors = {
  mdfe_browser_unavailable: "Não foi possível iniciar o navegador em segundo plano.",
  mdfe_portal_denied: "A SVRS recusou o acesso ao formulário de download.",
  mdfe_portal_rate_limited: "A SVRS bloqueou o download por excesso de consultas deste IP.",
  mdfe_certificate_not_authorized: "A SVRS recusou o download porque o CNPJ-base do certificado difere do CNPJ-base dos envolvidos no MDF-e.",
  mdfe_challenge_required: "A SVRS exige uma verificação manual para liberar o download.",
  mdfe_form_unidentified: "Não foi possível identificar o campo de chave ou o botão de download da SVRS.",
  mdfe_download_unavailable: "O portal não entregou o XML no prazo. A existência do MDF-e não foi confirmada pelo download.",
  mdfe_portal_access_failed: "Não foi possível abrir o portal de download da SVRS.",
  mdfe_portal_unexpected: "O portal da SVRS respondeu com uma página inesperada durante o download.",
  mdfe_xml_invalid: "O arquivo retornado não passou na verificação do manifesto, da chave e do protocolo."
};
const services = {
  open: ["MDFeConsNaoEnc", "mdfeConsNaoEnc", "consMDFeNaoEnc", "retConsMDFeNaoEnc"],
  situation: ["MDFeConsulta", "mdfeConsultaMDF", "consSitMDFe", "retConsSitMDFe"],
  status: ["MDFeStatusServico", "mdfeStatusServicoMDF", "consStatServMDFe", "retStatServMDFe"]
};
const child = (node, name) => node?.children.find((item) => item.name === name);
const value = (node, name) => child(node, name)?.text.trim() || "";

function parseResult(xml, mode) {
  const [, operation, , response] = services[mode];
  const root = parseXml(xml);
  const wrapper = child(child(root, "body"), operation.toLowerCase() + "result");
  const result = child(wrapper, response.toLowerCase()) || (mode === "status" && child(wrapper, "retconsstatservmdfe"));
  const status = value(result, "cstat");
  if (!/^\d{3,4}$/.test(status)) throw new Error("A SVRS retornou uma resposta MDF-e inválida.");
  const summary = { status, reason: value(result, "xmotivo") };
  if (mode === "status") return { ...summary, receivedAt: value(result, "dhrecbto") };
  if (mode === "situation") {
    const protocol = child(child(result, "protmdfe"), "infprot");
    const events = result.children.filter((node) => node.name === "proceventomdfe").map((node) => {
      const request = child(child(node, "eventomdfe"), "infevento");
      const registration = child(child(node, "reteventomdfe"), "infevento");
      return { type: value(request, "tpevento") || value(registration, "tpevento"), description: value(registration, "xevento") || value(child(child(request, "detevento"), "evencmdfe"), "descevento"), protocol: value(registration, "nprot") };
    });
    return { ...summary, protocol: value(protocol, "nprot"), events };
  }
  const manifests = result.children.filter((node) => node.name === "infmdfe").map((node) => ({
    key: value(node, "chmdfe"),
    protocol: value(node, "nprot")
  }));
  if (manifests.some(({ key, protocol }) => !/^\d{20}58\d{22}$/.test(key) || !/^\d{15}$/.test(protocol)) ||
      (status === "111" && !manifests.length) || (status !== "111" && manifests.length)) {
    throw new Error("A SVRS retornou uma lista de MDF-e inválida.");
  }
  return { ...summary, manifests };
}

const parseOpenManifests = (xml) => parseResult(xml, "open");

async function requestSvrs(endpoint, certificate, { body, action } = {}) {
  const ca = [...(tls.getCACertificates?.() || tls.rootCertificates), await loadIcpRoot()];
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: body ? "POST" : "GET",
      pfx: certificate.pfx,
      passphrase: certificate.passphrase,
      ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      agent: false,
      signal: AbortSignal.timeout(20000),
      headers: body ? {
        "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
        "Content-Length": Buffer.byteLength(body)
      } : { Accept: "text/html" }
    }, async (response) => {
      try {
        if (response.statusCode !== 200) {
          response.resume();
          if (!body) return resolve({ httpStatus: response.statusCode, location: response.headers.location });
          throw Object.assign(new Error("A SVRS recusou a conexão HTTP."), { httpStatus: response.statusCode });
        }
        response.setEncoding("utf8");
        let data = "";
        for await (const chunk of response) {
          data += chunk;
          if (data.length > 2 * 1024 * 1024) throw new Error("Resposta MDF-e excedeu o tamanho esperado.");
        }
        resolve({ httpStatus: response.statusCode, contentType: response.headers["content-type"], data });
      } catch (error) { reject(error); }
    });
    request.on("error", reject);
    request.end(body);
  });
}

function inspectDownloadPage({ httpStatus, location, contentType, data = "" }) {
  const redirectPath = location ? new URL(location, downloadPortal).pathname : "";
  if (httpStatus === 401 || httpStatus === 403 || /^\/erro\/forbidden\/?$/i.test(redirectPath)) {
    return { state: "denied", httpStatus };
  }
  if (httpStatus === 429 || /IP não autorizado devido múltiplas consultas/i.test(data)) {
    return { state: "rate_limited", httpStatus };
  }
  if (httpStatus !== 200 || !/^text\/html\b/i.test(contentType || "")) return { state: "unexpected", httpStatus };
  const form = /<form\b[^>]*\bid\s*=\s*["']frmDownloadXmlDfe["'][^>]*>([\s\S]*?)<\/form\s*>/i.exec(data)?.[1] || "";
  const fieldNames = [...form.matchAll(/<(?:input|select)\b[^>]*>/gi)]
    .filter(([tag]) => !/\btype\s*=\s*["']?hidden\b/i.test(tag))
    .flatMap(([tag]) => [...tag.matchAll(/\b(?:id|name)\s*=\s*["']([\w-]+)["']/gi)].map((match) => match[1]));
  const filters = [];
  if (fieldNames.some((name) => /chave|chmdfe/i.test(name))) filters.push("key");
  if (fieldNames.some((name) => /data|periodo/i.test(name))) filters.push("period");
  const challenge = /(?:g-recaptcha|h-captcha|img_captcha|captchaResponse|recaptcha\/api\.js)/i.test(data);
  return { state: filters.length ? "form" : "unidentified", httpStatus, filters, challenge };
}

async function queryMdfe(document, certificate, mode, key) {
  if (mode === "download") return inspectDownloadPage(await requestSvrs(downloadPortal, certificate));
  const [name, operation, requestRoot] = services[mode];
  const endpoint = `https://mdfe.svrs.rs.gov.br/ws/${name}/${name}.asmx`;
  const service = `${namespace}/wsdl/${name}`;
  const tag = document.length === 14 ? "CNPJ" : "CPF";
  const fields = mode === "open" ? `<xServ>CONSULTAR NÃO ENCERRADOS</xServ><${tag}>${document}</${tag}>` :
    mode === "situation" ? `<xServ>CONSULTAR</xServ><chMDFe>${key}</chMDFe>` : "<xServ>STATUS</xServ>";
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>
<mdfeDadosMsg xmlns="${service}">
<${requestRoot} xmlns="${namespace}" versao="3.00"><tpAmb>1</tpAmb>${fields}</${requestRoot}>
</mdfeDadosMsg></soap:Body></soap:Envelope>`;
  const response = await requestSvrs(endpoint, certificate, { body, action: `${service}/${operation}` });
  return parseResult(response.data, mode);
}

async function recordMdfeAccess(entry) {
  const directory = path.join(getUserDataDir(), "diagnostics");
  await fs.mkdir(directory, { recursive: true });
  await fs.appendFile(path.join(directory, "mdfe-access.jsonl"), JSON.stringify(entry) + "\n", "utf8");
}

function installMdfeRoutes(app, options = {}) {
  const { query = queryMdfe, record = recordMdfeAccess, download = downloadOwnManifest,
    xmlRoot = path.join(getUserDataDir(), "mdfe-distribution"), archiveRoot = options.xmlRoot ? xmlRoot : undefined } = options;
  app.post("/api/companies/:id/mdfe/:mode", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const catalog = app.locals.companyCatalog;
    let certificate;
    const started = Date.now();
    const { mode } = req.params;
    if (!["download", "xml"].includes(mode) && !Object.hasOwn(services, mode)) return res.status(404).json({ error: "Consulta MDF-e desconhecida." });
    const audit = { at: new Date(started).toISOString(), mode, result: "catalog_error" };
    let reply;
    try {
      const { companies } = await catalog.list();
      const company = companies.find(({ id }) => id === req.params.id);
      if (!company) return res.status(404).json({ error: "Empresa não encontrada." });
      audit.companyId = company.id;
      audit.result = "invalid_document";
      const document = String(company.cnpj || company.document || "").replace(/\D/g, "");
      if (!/^(?:\d{11}|\d{14})$/.test(document)) return res.status(400).json({ error: "Confira o CNPJ ou CPF cadastrado." });
      const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
      const issuer = document.length === 14 ? key.slice(6, 20) : key.slice(9, 20);
      const sameIssuer = document.length === 14 ? issuer.slice(0, 8) === document.slice(0, 8) :
        key.slice(6, 20) === document.padStart(14, "0");
      if (["situation", "xml"].includes(mode) && (!/^\d{20}58\d{22}$/.test(key) || !sameIssuer)) {
        audit.result = "invalid_key";
        return res.status(400).json({ error: "Informe uma chave MDF-e de 44 dígitos emitida pelo mesmo CNPJ-base ou pelo CPF selecionado." });
      }
      try {
        certificate = await catalog.loadCertificate(company.id, { encryption: app.locals.companyCredentialEncryption });
      } catch {
        audit.result = "certificate_open_failed";
        return res.status(422).json({ error: "O aplicativo não conseguiu abrir o certificado A1 salvo para esta empresa." });
      }
      audit.result = "certificate_missing";
      if (!certificate) return res.status(422).json({ error: "Vincule um certificado A1 no cadastro desta empresa para consultar MDF-e." });
      if (document.length === 14 && /^\d{14}$/.test(certificate.cnpj || "") && certificate.cnpj.slice(0, 8) !== document.slice(0, 8)) {
        audit.result = "certificate_base_mismatch";
        return res.status(403).json({ error: "O CNPJ-base do A1 cadastrado difere do CNPJ-base da empresa selecionada." });
      }
      audit.result = "svrs_error";
      if (mode === "xml") {
        const directory = path.join(xmlRoot, issuer);
        const cached = await findFiscalDocument({ company: issuer, type: "mdfe", key, root: archiveRoot, legacyDirectories: [directory] });
        const xml = cached ? validateManifestXml(cached, key) : await download(key, certificate);
        await saveFiscalBatch({ company: issuer, type: "mdfe", notes: [{ key, buffer: xml }], root: archiveRoot, legacyDirectories: [directory] });
        audit.result = "xml_downloaded";
        res.attachment(`${key}-mdfe.xml`).type("application/xml").send(xml);
        return;
      }
      reply = await query(document, certificate, mode, key);
      if (mode === "download") {
        audit.result = `download_portal_${reply.state}`;
        audit.httpStatus = reply.httpStatus;
        audit.filters = reply.filters;
        audit.challenge = reply.challenge;
        return res.json(reply);
      }
      audit.result = mode === "open" ? (reply.status === "111" ? "found" : reply.status === "112" ? "empty" : "svrs_rejected") :
        mode === "situation" && reply.status === "217" ? "manifest_not_found" : "svrs_response";
      audit.svrsStatus = reply.status;
      if (mode === "open") audit.manifestCount = reply.manifests.length;
      res.json(reply);
    } catch (error) {
      if (error.httpStatus) audit.httpStatus = error.httpStatus;
      if (error.code) audit.errorCode = error.code;
      if (mode === "xml" && Object.hasOwn(downloadErrors, error.code)) {
        audit.result = error.code;
        const status = error.code === "mdfe_portal_rate_limited" ? 429 :
          error.code === "mdfe_certificate_not_authorized" ? 403 : 502;
        return res.status(status)
          .json({ code: error.code, error: downloadErrors[error.code] });
      }
      const detail = error.httpStatus ? ` (HTTP ${error.httpStatus})` : error.code ? ` (${error.code})` : "";
      res.status(502).json({ error: `Não foi possível concluir a consulta de MDF-e na SVRS${detail}.` });
    } finally {
      certificate?.pfx.fill(0);
      if (audit.companyId) {
        audit.durationMs = Date.now() - started;
        try { await record(audit); }
        catch (error) { console.warn("Falha ao registrar consulta MDF-e", error.code || "write_failed"); }
      }
    }
  });
}

module.exports = { installMdfeRoutes, inspectDownloadPage, parseOpenManifests, parseResult };
