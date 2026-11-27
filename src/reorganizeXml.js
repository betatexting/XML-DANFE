const fs = require("fs/promises");
const path = require("path");
const { constants } = require("fs");
const { createHash } = require("crypto");
const { parseXml } = require("./localXml");
const { normalizeOrganization } = require("./xmlStorage");

function classifyXml(xml, cnpj) {
  const root = parseXml(xml);
  const child = (node, name) => node?.children.find((item) => item.name === name);
  const value = (node, name) => child(node, name)?.text.trim() || "";
  const nfe = root.name === "nfe" ? root : ["nfeproc", "procnfe"].includes(root.name) ? child(root, "nfe") : null;
  const info = child(nfe, "infnfe");
  if (!info) throw new Error("Documento nao e uma NF-e completa.");
  const emitter = value(child(info, "emit"), "cnpj");
  const recipient = value(child(info, "dest"), "cnpj");
  const type = emitter === cnpj ? "saidas" : recipient === cnpj ? "entradas" : "";
  if (!type) throw new Error("CNPJ nao pertence ao emitente ou destinatario.");
  const ide = child(info, "ide");
  const date = value(ide, "dhemi") || value(ide, "demi");
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match) throw new Error("Data de emissao ausente ou invalida.");
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error("Data de emissao invalida.");
  }
  const id = Object.values(info.attributes).find((attribute) => attribute.local.toLowerCase() === "id")?.value || "";
  const key = /^NFe\d{44}$/.test(id) ? id.slice(3) : "";
  return { period: `${match[1]}-${match[2]}`, type, key };
}

function describeError(error) {
  if (["EACCES", "EPERM"].includes(error.code)) return "Sem permissao para ler, gravar ou excluir nesta pasta. Verifique as permissoes do usuario do Windows e se o arquivo esta bloqueado por outro programa.";
  return error.message;
}

function analyzeXml(xml, cnpj) {
  try { return { ...classifyXml(xml, cnpj), warning: "" }; }
  catch (originalError) {
    // Tolerate only unescaped ampersands for classification. Never rewrite fiscal XML.
    const escaped = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;");
    if (escaped === xml || /<!DOCTYPE/i.test(xml)) throw originalError;
    try {
      return { ...classifyXml(escaped, cnpj), warning: "XML com & sem escape; classificado por leitura tolerante, conteudo original preservado (XML continua invalido)." };
    } catch (_error) { throw originalError; }
  }
}

function typeIdentity(name) {
  const text = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /^entradas?$/.test(text) ? "entradas" : /^saidas?$/.test(text) ? "saidas" : "";
}

function destinationDirectory(base, folders, period, type, cnpj) {
  const periods = folders.filter((folder) => path.basename(folder) === period).filter((folder) => {
    const companies = path.relative(base, folder).split(path.sep).map((part) => part.replace(/[.\- _]/g, "")).filter((part) => /^\d{14}$/.test(part));
    return companies.every((company) => company === cnpj);
  });
  // Reuse a complete classification before considering a new subfolder.
  const complete = periods.flatMap((folder) => folders.filter((item) => path.dirname(item) === folder && typeIdentity(path.basename(item)) === type));
  const candidates = complete.length ? complete : periods;
  const companyCandidates = candidates.filter((folder) => path.relative(base, folder).split(path.sep).some((part) => part.replace(/[.\- _]/g, "") === cnpj));
  const preferred = companyCandidates.length ? companyCandidates : candidates;
  if (preferred.length > 1) throw new Error(`Mais de uma pasta existente para ${period}/${type}. Selecione a pasta da empresa para evitar destino ambiguo.`);
  if (preferred.length) return complete.length ? preferred[0] : path.join(preferred[0], type);
  return path.join(base, period, type);
}

const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function reorganizeXml({ directory, cnpj }) {
  const selection = normalizeOrganization({ type: "auto", cnpj });
  if (typeof directory !== "string" || !directory.trim()) throw new Error("Informe a pasta dos XMLs.");
  const base = path.resolve(directory);
  const stat = await fs.lstat(base);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Selecione uma pasta valida, sem atalhos.");
  // Snapshot the sources before creating destinations, so moved files are never scanned twice.
  const files = [];
  const results = [];
  const folders = [base];
  const pending = [base];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch (error) {
      results.push({ source: current, status: "skipped", code: error.code, message: describeError(error) });
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name.toLowerCase() !== "diagnosticos") { pending.push(file); folders.push(file); }
      else if (entry.isFile() && /\.xml$/i.test(entry.name)) files.push(file);
    }
  }
  const hashes = new Map();
  const keys = new Map();
  const documents = [];
  // Read all documents first, including old AAAA/entradas and AAAA/saidas folders.
  for (const source of files.sort()) {
    try {
      const bytes = await fs.readFile(source);
      const { period, type, key, warning } = analyzeXml(bytes.toString("utf8"), selection.cnpj);
      const destination = destinationDirectory(base, folders, period, type, selection.cnpj);
      const target = path.join(destination, path.basename(source));
      documents.push({ source, target, key, warning, hash: hashBytes(bytes) });
    } catch (error) {
      results.push({ source, status: "skipped", code: error.code, message: describeError(error) });
    }
  }
  documents.sort((a, b) => Number(b.source === b.target) - Number(a.source === a.target) || a.source.localeCompare(b.source));
  for (const document of documents) {
    const { source, key, hash, warning } = document;
    let target = document.target;
    try {
      const duplicate = hashes.get(hash);
      const sameKey = key && keys.get(key);
      if (duplicate) {
        results.push({ source, target: duplicate, status: "duplicate", message: "XML duplicado por conteudo; copia preservada na origem." });
        continue;
      }
      if (source === target) {
        results.push({ source, target, status: "unchanged", warning, message: "Ja organizado." });
        hashes.set(hash, target);
        if (key) keys.set(key, target);
        continue;
      }
      // Different versions of a key are retained side by side, without replacing either.
      let variant = Boolean(sameKey);
      try {
        const existing = await fs.readFile(target);
        if (hashBytes(existing) === hash) {
          results.push({ source, target, status: "duplicate", message: "Destino possui conteudo identico; copia preservada na origem." });
          hashes.set(hash, target);
          continue;
        }
        variant = true;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (variant) {
        target = path.join(path.dirname(target), `${path.basename(target, path.extname(target))}-versao-${hash}.xml`);
        try {
          if (hashBytes(await fs.readFile(target)) === hash) {
            results.push({ source, target, status: "duplicate", message: "Versao identica ja organizada; copia preservada na origem." });
            continue;
          }
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      const destination = path.dirname(target);
      try {
        const info = await fs.lstat(destination);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Destino nao e uma pasta regular.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await fs.mkdir(destination, { recursive: true });
      }
      // Exclusive copy prevents overwriting even if another operation creates the target.
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      const copiedHash = createHash("sha256").update(await fs.readFile(target)).digest("hex");
      const sourceHash = createHash("sha256").update(await fs.readFile(source)).digest("hex");
      if (copiedHash !== hash || sourceHash !== hash) throw new Error("Arquivo alterado durante a movimentacao; origem preservada.");
      await fs.unlink(source);
      hashes.set(hash, target);
      if (key) keys.set(key, target);
      results.push({ source, target, status: "moved", variant, warning, message: variant ? "Movido como versao distinta; ambos os conteudos preservados." : "Movido." });
    } catch (error) {
      results.push({ source, target, status: "skipped", code: error.code, message: error.code === "EEXIST" ? "Destino ja existe com outro arquivo; original preservado." : describeError(error) });
    }
  }
  return {
    directory: base, total: files.length,
    moved: results.filter((item) => item.status === "moved").length,
    unchanged: results.filter((item) => item.status === "unchanged").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    duplicates: results.filter((item) => item.status === "duplicate").length,
    conflicts: results.filter((item) => item.status === "conflict").length,
    versions: results.filter((item) => item.variant).length,
    warnings: results.filter((item) => item.warning).length,
    results
  };
}

module.exports = { classifyXml, reorganizeXml };
