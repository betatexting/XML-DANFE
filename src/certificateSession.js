const crypto = require("crypto");

const SESSION_TTL_MS = 15 * 60 * 1000;
const certificateSessions = new Map();

function removeExpiredSessions() {
  const now = Date.now();

  for (const [id, session] of certificateSessions) {
    if (session.expiresAt <= now) {
      session.buffer.fill(0);
      certificateSessions.delete(id);
    }
  }
}

function storeCertificate({ buffer, fileName = "certificado.pfx" }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("O arquivo do certificado esta vazio.");
  }

  removeExpiredSessions();

  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  certificateSessions.set(id, {
    buffer,
    fileName,
    expiresAt
  });

  return {
    id,
    fileName,
    expiresAt
  };
}

function getCertificate(id) {
  removeExpiredSessions();

  if (typeof id !== "string" || !id.trim()) {
    return null;
  }

  return certificateSessions.get(id.trim()) ?? null;
}

function discardCertificate(id) {
  if (typeof id === "string" && id.trim()) {
    const session = certificateSessions.get(id.trim());
    if (session?.buffer) {
      session.buffer.fill(0);
    }
    certificateSessions.delete(id.trim());
  }
}

module.exports = {
  discardCertificate,
  getCertificate,
  storeCertificate
};
