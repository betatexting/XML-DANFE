const fs = require("fs/promises");
const path = require("path");
const sax = require("sax");
const { normalizeOrganization } = require("./xmlStorage");
const { storageBase } = require("./storageDirectories");

function parseXml(xml) {
  const parser = sax.parser(true, { xmlns: true, trim: false });
  const stack = [];
  const roots = [];
  parser.ondoctype = () => { throw new Error("DOCTYPE nao aceito."); };
  parser.onerror = (error) => { throw error; };
  parser.onopentag = (tag) => {
    const node = { name: tag.local.toLowerCase(), attributes: tag.attributes, children: [], text: "" };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  };
  parser.ontext = parser.oncdata = (text) => {
    if (stack.length) stack[stack.length - 1].text += text;
  };
  parser.onclosetag = () => stack.pop();
  parser.write(String(xml).trim()).close();
  if (roots.length !== 1) throw new Error("XML deve conter um unico documento.");
  return roots[0];
}

const child = (node, name) => node?.children.find((item) => item.name === name);
const value = (node, name) => child(node, name)?.text.trim() || "";

function inspectLocalXml(xml, key, organization) {
  try {
    if (!/^\d{44}$/.test(key)) return null;
    const selection = normalizeOrganization(organization);
    const root = parseXml(xml);
    if (!["nfeproc", "procnfe"].includes(root.name)) return null;
    const info = child(child(root, "nfe"), "infnfe");
    const protocol = child(child(root, "protnfe"), "infprot");
    if (!info || !protocol || !child(info, "det") || !child(info, "total")) return null;
    const id = Object.values(info.attributes).find((attribute) => attribute.local.toLowerCase() === "id")?.value || value(info, "id");
    if (id !== `NFe${key}` || value(protocol, "chnfe") !== key) return null;
    if (!["100", "150"].includes(value(protocol, "cstat"))) return null;
    const emitter = value(child(info, "emit"), "cnpj");
    const recipient = value(child(info, "dest"), "cnpj");
    if (emitter !== key.slice(6, 20)) return null;
    if (selection.cnpj && selection.cnpj !== emitter && selection.cnpj !== recipient) return null;
    if (selection.type === "entradas" && selection.cnpj && selection.cnpj !== recipient) return null;
    if (selection.type === "saidas" && selection.cnpj && selection.cnpj !== emitter) return null;
    if (selection.type === "entradas" && !selection.cnpj && !/^\d{14}$/.test(recipient)) return null;
    const ide = child(info, "ide");
    const documentIssueDate = value(ide, "dhemi") || value(ide, "demi");
    const match = documentIssueDate.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { documentIssueDate };
  } catch (_error) {
    return null;
  }
}

async function findLocalXmls({ keys, downloadsDir, organization }) {
  const remaining = new Set(keys.filter((key) => /^\d{44}$/.test(key)));
  const found = new Map();
  const directories = [storageBase(downloadsDir)];
  while (directories.length && remaining.size) {
    const directory = directories.shift();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (_error) { continue; }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      // Do not follow junctions/symlinks into other directories or diagnostic captures.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() !== "diagnosticos") directories.push(filePath);
        continue;
      }
      const match = entry.name.match(/^(\d{44})\.xml$/i);
      if (!entry.isFile() || !match || !remaining.has(match[1])) continue;
      const key = match[1];
      let metadata;
      try { metadata = inspectLocalXml(await fs.readFile(filePath, "utf8"), key, organization); }
      catch (_error) { continue; }
      if (!metadata) continue;
      found.set(key, {
        key, status: "success", alreadyAvailable: true, lookupMode: "local-file", downloadMethod: "local-file",
        filePath, fileName: entry.name, attemptCount: 0, ...metadata
      });
      remaining.delete(key);
    }
  }
  return found;
}

module.exports = { findLocalXmls, inspectLocalXml };
