const fs = require("fs/promises");
const path = require("path");
const { resolveUserDataDir } = require("./runtimePaths");
const HOUR_MS = 60 * 60 * 1000;

function createCertificateQuota({ filePath, now = Date.now, limit = 20 } = {}) {
  let queue = Promise.resolve();
  async function update(cnpj, block) {
    const file = filePath || path.join(await resolveUserDataDir(), "certificate-point-limits.json");
    let data;
    try { data = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; data = {}; }
    const time = now();
    // Conservative shared budget for the certificate's company base, across establishments.
    const base = cnpj.slice(0, 8);
    const state = data[base] || { calls: [], blockedUntil: 0 };
    state.calls = state.calls.filter((at) => at > time - HOUR_MS);
    if (block) state.blockedUntil = time + HOUR_MS;
    const allowed = !block && state.blockedUntil <= time && state.calls.length < limit;
    if (allowed) state.calls.push(time);
    data[base] = state;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + ".tmp", JSON.stringify(data), "utf8");
    await fs.rename(file + ".tmp", file);
    return allowed;
  }
  function serialized(cnpj, block) {
    const task = queue.then(() => update(cnpj, block));
    queue = task.catch(() => {});
    return task;
  }
  return { acquire: (cnpj) => serialized(cnpj, false), block: (cnpj) => serialized(cnpj, true) };
}

module.exports = { createCertificateQuota, certificateQuota: createCertificateQuota(), HOUR_MS };
