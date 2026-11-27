const os = require("os");
const fs = require("fs/promises");
const path = require("path");

function getUserDataDir() {
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData.trim()) {
    return path.join(localAppData, "ConsultaDanfeAutomacao");
  }

  return path.join(os.homedir(), "AppData", "Local", "ConsultaDanfeAutomacao");
}

async function resolveUserDataDir() {
  const candidates = [
    getUserDataDir(),
    path.join(process.cwd(), ".app-data"),
    path.join(os.tmpdir(), "ConsultaDanfeAutomacao")
  ];
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    try {
      await fs.mkdir(candidate, { recursive: true });
      return candidate;
    } catch (_error) {
      // Tenta o proximo caminho ate achar um local gravavel.
    }
  }

  return uniqueCandidates.at(-1);
}

function getFiscalDownloadsDir() {
  let downloads = path.join(os.homedir(), "Downloads");
  try {
    const { app } = require("electron");
    if (app?.isReady()) downloads = app.getPath("downloads");
  } catch { /* Standalone server uses the conventional user Downloads folder. */ }
  return path.join(downloads, "Notas Fiscais");
}

module.exports = {
  getFiscalDownloadsDir,
  getUserDataDir,
  resolveUserDataDir
};
