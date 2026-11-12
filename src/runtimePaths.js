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

module.exports = {
  getUserDataDir,
  resolveUserDataDir
};
