const fs = require("fs/promises");
const path = require("path");

function folderIdentity(name) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (/^(entradas?|saidas?)$/.test(normalized)) {
    return { type: normalized.startsWith("entrada") ? "entradas" : "saidas" };
  }
  const digits = name.replace(/[.\-\s_]/g, "");
  if (/^\d{14}$/.test(digits)) return { cnpj: digits };
  const yearFirst = normalized.match(/^(\d{4})[-_. ](0[1-9]|1[0-2])$/);
  const monthFirst = normalized.match(/^(0[1-9]|1[0-2])[-_. ](\d{4})$/);
  if (yearFirst) return { period: `${yearFirst[1]}-${yearFirst[2]}` };
  if (monthFirst) return { period: `${monthFirst[2]}-${monthFirst[1]}` };
  return {};
}

function storageBase(downloadsDir) {
  const selected = path.resolve(downloadsDir);
  let current = selected;
  let foundCompany = false;
  while (path.dirname(current) !== current) {
    const identity = folderIdentity(path.basename(current));
    if (!identity.cnpj && !identity.period && !identity.type) break;
    if (identity.cnpj) foundCompany = true;
    current = path.dirname(current);
  }
  return foundCompany ? current : selected;
}

async function directoriesIn(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => ({ directory: path.join(directory, entry.name), ...folderIdentity(entry.name) }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function chooseExisting(candidates, canonicalName, selected) {
  const preferred = candidates.filter((candidate) => candidate.directory === selected || selected.startsWith(`${candidate.directory}${path.sep}`));
  if (preferred.length) return preferred.sort((a, b) => b.directory.length - a.directory.length)[0].directory;
  const descendants = candidates.filter((candidate) => candidate.directory.startsWith(`${selected}${path.sep}`));
  if (descendants.length) return descendants.sort((a, b) => a.directory.length - b.directory.length || a.directory.localeCompare(b.directory))[0].directory;
  const canonical = candidates.find((candidate) => path.basename(candidate.directory) === canonicalName);
  if (canonical) return canonical.directory;
  if (candidates.length > 1) throw new Error("Ha mais de uma pasta para esta classificacao. Selecione a pasta correta em Onde salvar.");
  return candidates[0]?.directory || "";
}

async function resolveStorageDirectory({ downloadsDir, cnpj, period, type }) {
  const selected = path.resolve(downloadsDir);
  const base = storageBase(selected);
  const companies = (await directoriesIn(base)).filter((entry) => entry.cnpj === cnpj);
  const completed = [];
  const companyCandidates = [...companies];
  const pending = companies.map((entry) => ({ ...entry, hasPeriod: false, hasType: !type }));
  while (pending.length) {
    const current = pending.shift();
    if (current.hasPeriod && current.hasType) completed.push(current);
    for (const entry of await directoriesIn(current.directory)) {
      if (entry.cnpj && entry.cnpj !== cnpj) continue;
      if (entry.period && entry.period !== period) continue;
      if (entry.type && entry.type !== type) continue;
      if (!entry.cnpj && !entry.period && !entry.type) continue;
      if (entry.cnpj) companyCandidates.push(entry);
      pending.push({
        ...entry,
        hasPeriod: current.hasPeriod || entry.period === period,
        hasType: current.hasType || (type && entry.type === type)
      });
    }
  }
  const destination = chooseExisting(completed, type || period, selected);
  if (destination) return destination;
  const companyDirectory = chooseExisting(companyCandidates, cnpj, selected) || path.join(base, cnpj);
  const children = await directoriesIn(companyDirectory);
  const typeFirst = type && chooseExisting(children.filter((entry) => entry.type === type), type, selected);
  const periodFirst = chooseExisting(children.filter((entry) => entry.period === period), period, selected);
  if (periodFirst) {
    if (!type) return periodFirst;
    const existingType = chooseExisting((await directoriesIn(periodFirst)).filter((entry) => entry.type === type), type, selected);
    return existingType || path.join(periodFirst, type);
  }
  if (typeFirst) {
    const existingPeriod = chooseExisting((await directoriesIn(typeFirst)).filter((entry) => entry.period === period), period, selected);
    return existingPeriod || path.join(typeFirst, period);
  }
  return type ? path.join(companyDirectory, period, type) : path.join(companyDirectory, period);
}

module.exports = { resolveStorageDirectory, storageBase };
