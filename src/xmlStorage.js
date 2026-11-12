const fs = require("fs/promises");
const path = require("path");
const { getIssueDateFromXml, getIssueMonthFromAccessKey } = require("./accessKeys");
const { resolveStorageDirectory } = require("./storageDirectories");

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
  return { type, cnpj, ...(value?.requireXmlMetadata === true ? { requireXmlMetadata: true } : {}) };
}

function getPartyCnpj(xml, party) {
  const block = String(xml).match(new RegExp(`<(?:\\w+:)?${party}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${party}>`, "i"));
  return block?.[1].match(/<(?:\w+:)?CNPJ\b[^>]*>\s*(\d{14})\s*<\/(?:\w+:)?CNPJ>/i)?.[1] || "";
}

function getCertificateOrganization(certificate) {
  return normalizeOrganization({ type: "auto", cnpj: certificate.cnpj, requireXmlMetadata: true });
}

async function saveOrganizedXml(xml, key, downloadsDir, organization) {
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
  if (type === "auto") {
    if (selection.cnpj === emitter) type = "saidas";
    else if (selection.cnpj === recipient) type = "entradas";
    else throw new Error("O CNPJ informado nao e emitente nem destinatario desta nota.");
  }
  const cnpj = selection.cnpj || (type === "entradas" ? recipient : emitter);
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

  const directory = await resolveStorageDirectory({ downloadsDir, cnpj, period, type });
  await fs.mkdir(directory, { recursive: true });
  const targetFile = path.join(directory, `${key}.xml`);
  await fs.writeFile(targetFile, `${xml.trim()}\n`, "utf8");
  return targetFile;
}

module.exports = { getCertificateOrganization, normalizeOrganization, saveOrganizedXml };
