const path = require("path");
const { saveXmlFile } = require("./fiscalDocumentStore");
const { getFiscalDownloadsDir } = require("./runtimePaths");
const { getIssueDateFromXml, getIssueMonthFromAccessKey } = require("./accessKeys");
const { resolveStorageDirectory } = require("./storageDirectories");
const { LookupError } = require("./lookupResult");

function normalizeOrganization(value = {}) {
  if (typeof value === "string") value = JSON.parse(value);
  const type = value?.type || "";
  const rawCnpj = String(value?.cnpj || "").trim();
  const cnpj = rawCnpj.replace(/[.\/\-\s]/g, "");
  if (!["", "entradas", "saidas", "auto"].includes(type)) {
    throw new Error("Selecione entradas, saidas ou identificacao pelo CNPJ.");
  }
  if ((rawCnpj && !/^\d{14}$/.test(cnpj)) || (type === "auto" && !cnpj)) {
    throw new Error("Informe um CNPJ com 14 digitos.");
  }
  return { type, cnpj, ...(value?.includeBranches === true ? { includeBranches: true } : {}), ...(value?.requireXmlMetadata === true ? { requireXmlMetadata: true } : {}) };
}

function getPartyCnpj(xml, party) {
  const block = String(xml).match(new RegExp(`<(?:\\w+:)?${party}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${party}>`, "i"));
  return block?.[1].match(/<(?:\w+:)?CNPJ\b[^>]*>\s*(\d{14})\s*<\/(?:\w+:)?CNPJ>/i)?.[1] || "";
}

function getCertificateOrganization(certificate) {
  return normalizeOrganization({ type: "auto", cnpj: certificate.cnpj, includeBranches: true, requireXmlMetadata: true });
}

function classifyXml(xml, key, organization) {
  if (!/^\d{44}$/.test(key)) {
    throw new Error("Chave invalida para organizar o XML.");
  }

  const selection = normalizeOrganization(organization);
  const xmlEmitter = getPartyCnpj(xml, "emit");
  if (selection.requireXmlMetadata && !xmlEmitter) {
    throw new Error("O XML nao possui CNPJ do emitente para classificar a nota.");
  }
  const emitter = xmlEmitter || key.slice(6, 20);
  const recipient = getPartyCnpj(xml, "dest");
  let type = selection.type;
  let company = selection.cnpj;
  if (selection.includeBranches && company) {
    const belongs = (cnpj) => /^\d{14}$/.test(cnpj) && cnpj.slice(0, 8) === company.slice(0, 8);
    // Mixed company batches are classified from the XML, never from a supplier's key.
    if (belongs(emitter)) { company = emitter; type = "saidas"; }
    else if (belongs(recipient)) { company = recipient; type = "entradas"; }
    else throw new Error("O CNPJ informado nao e emitente nem destinatario desta nota ou de suas filiais.");
  }
  if (type === "auto") {
    if (selection.cnpj === emitter) type = "saidas";
    else if (selection.cnpj === recipient) type = "entradas";
    else throw new Error("O CNPJ informado nao e emitente nem destinatario desta nota.");
  }
  const cnpj = company || (type === "entradas" ? recipient : emitter);
  if (!cnpj) {
    throw new Error("A nota nao possui CNPJ do destinatario. Informe o CNPJ da empresa para organizar as entradas.");
  }
  const issueDate = getIssueDateFromXml(xml);
  const xmlMonth = issueDate.slice(0, 7);
  const validXmlMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(xmlMonth);
  if (selection.requireXmlMetadata && !validXmlMonth) {
    throw new Error("O XML nao possui data de emissao valida para organizar a nota.");
  }
  const period = validXmlMonth
    ? xmlMonth
    : getIssueMonthFromAccessKey(key);
  if (!period) {
    throw new Error("Periodo de emissao invalido para organizar o XML.");
  }

  return { cnpj, period, type, emitter, recipient };
}

async function saveOrganizedXml(xml, key, downloadsDir = getFiscalDownloadsDir(), organization) {
  try {
    const classification = classifyXml(xml, key, organization);
    const directory = await resolveStorageDirectory({ downloadsDir, ...classification });
    const content = `${xml.trim()}\n`;
    return (await saveXmlFile(path.join(directory, `${key}.xml`), Buffer.from(content), { versions: true })).file;
  } catch (error) {
    throw new LookupError(error.message, { errorCode: "xml_organization_failed", retryable: false });
  }
}

module.exports = { classifyXml, getPartyCnpj, getCertificateOrganization, normalizeOrganization, saveOrganizedXml };
