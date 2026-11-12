const fs = require("fs/promises");
const path = require("path");
const { resolveUserDataDir } = require("./runtimePaths");

let storageDirPromise = null;

function normalizeCnpj(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeNsu(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.padStart(15, "0").slice(-15);
}

async function getStorageDir() {
  if (!storageDirPromise) {
    storageDirPromise = resolveUserDataDir().then((userDataDir) =>
      path.join(userDataDir, "nfe-distribution")
    );
  }

  const storageDir = await storageDirPromise;
  await fs.mkdir(storageDir, { recursive: true });
  return storageDir;
}

async function getCursorFilePath() {
  return path.join(await getStorageDir(), "cursors.json");
}

async function readCursors() {
  try {
    const raw = await fs.readFile(await getCursorFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Nao foi possivel ler o cursor da distribuicao DF-e.");
    }
    return {};
  }
}

async function getLastNsu(cnpj) {
  const state = await getDistributionState(cnpj);
  return state.ultNsu;
}

async function getDistributionState(cnpj) {
  const normalizedCnpj = normalizeCnpj(cnpj);
  const cursors = await readCursors();
  const state = cursors[normalizedCnpj] || {};

  return {
    ultNsu: normalizeNsu(state.ultNsu),
    maxNsu: normalizeNsu(state.maxNsu),
    nextAllowedAt: typeof state.nextAllowedAt === "string" ? state.nextAllowedAt : ""
  };
}

async function saveDistributionState(cnpj, { ultNsu, maxNsu, nextAllowedAt = "" }) {
  const normalizedCnpj = normalizeCnpj(cnpj);
  const cursors = await readCursors();
  cursors[normalizedCnpj] = {
    ultNsu: normalizeNsu(ultNsu),
    maxNsu: normalizeNsu(maxNsu),
    nextAllowedAt,
    updatedAt: new Date().toISOString()
  };

  const cursorFilePath = await getCursorFilePath();
  await fs.writeFile(cursorFilePath, `${JSON.stringify(cursors, null, 2)}\n`, "utf8");
}

async function saveLastNsu(cnpj, ultNsu, maxNsu) {
  await saveDistributionState(cnpj, {
    ultNsu,
    maxNsu
  });
}

async function deferNextNsuCheck(cnpj, { ultNsu, maxNsu, delayMs }) {
  const currentState = await getDistributionState(cnpj);
  const safeDelayMs = Math.max(0, Number(delayMs) || 0);

  await saveDistributionState(cnpj, {
    ultNsu: ultNsu ?? currentState.ultNsu,
    maxNsu: maxNsu ?? currentState.maxNsu,
    nextAllowedAt: new Date(Date.now() + safeDelayMs).toISOString()
  });
}

async function getCacheFilePath(cnpj, key) {
  const normalizedCnpj = normalizeCnpj(cnpj);
  const normalizedKey = String(key || "").replace(/\D/g, "");
  const cacheDir = path.join(await getStorageDir(), "cache", normalizedCnpj);
  await fs.mkdir(cacheDir, { recursive: true });
  return path.join(cacheDir, `${normalizedKey}.xml`);
}

async function readCachedXml(cnpj, key) {
  try {
    return await fs.readFile(await getCacheFilePath(cnpj, key), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Nao foi possivel ler um XML do cache de distribuicao DF-e.");
    }
    return "";
  }
}

async function saveCachedXml(cnpj, key, xml) {
  await fs.writeFile(await getCacheFilePath(cnpj, key), `${String(xml).trim()}\n`, "utf8");
}

module.exports = {
  deferNextNsuCheck,
  getDistributionState,
  getLastNsu,
  normalizeNsu,
  readCachedXml,
  saveCachedXml,
  saveLastNsu
};
