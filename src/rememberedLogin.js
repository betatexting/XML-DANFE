const fs = require("fs/promises");
const path = require("path");

function createRememberedLogin({ filePath, encryption }) {
  async function file() { return typeof filePath === "function" ? filePath() : filePath; }
  return {
    async read() {
      if (!encryption.isEncryptionAvailable()) return null;
      let buffer;
      try { buffer = await fs.readFile(await file()); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      const value = JSON.parse(encryption.decryptString(buffer));
      if (typeof value.username !== "string" || typeof value.password !== "string" || value.username.length > 64 || value.password.length > 256) return null;
      return { username: value.username, password: value.password };
    },
    async save(value) {
      if (!encryption.isEncryptionAvailable()) throw new Error("A protecao de senhas do Windows nao esta disponivel. Entre sem marcar salvar.");
      if (typeof value?.username !== "string" || typeof value?.password !== "string" || value.username.length > 64 || value.password.length > 256) throw new Error("Dados de acesso invalidos.");
      const target = await file();
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target + ".tmp", encryption.encryptString(JSON.stringify({ username: value.username, password: value.password })), { mode: 0o600 });
      await fs.rename(target + ".tmp", target);
    },
    async clear() { await fs.rm(await file(), { force: true }); }
  };
}

module.exports = { createRememberedLogin };
