const path = require("path");
const { inspectCertificate } = require("./certificate");
const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
function certificateError(message) { return Object.assign(new Error(message), { status: 400 }); }
function inspectStoredCertificate({ pfx, passphrase, fileName }) {
  if (!Buffer.isBuffer(pfx) || !pfx.length || pfx.length > MAX_CERTIFICATE_BYTES || ![".pfx", ".p12"].includes(path.extname(fileName || "").toLowerCase())) throw certificateError("Selecione um certificado A1 .pfx ou .p12 de até 5 MB.");
  if (typeof passphrase !== "string" || passphrase.length > 512) throw certificateError("Confira a senha do certificado digital.");
  try { return inspectCertificate({ pfx, passphrase, requireCnpj: false }); }
  catch (error) { throw certificateError(error.message); }
}
function protectCompanyCertificate(certificate, encryption) {
  const metadata = inspectStoredCertificate(certificate);
  if (!encryption?.isEncryptionAvailable()) throw new Error("Protecao do Windows indisponivel.");
  return {
    fileName: path.basename(certificate.fileName), commonName: metadata.commonName,
    validTo: metadata.validTo, fingerprint: metadata.fingerprint,
    ...(metadata.cnpj ? { cnpj: metadata.cnpj } : {}),
    encryptedPayload: encryption.encryptString(JSON.stringify({ pfx: certificate.pfx.toString("base64"), passphrase: certificate.passphrase })).toString("base64")
  };
}
function restoreCompanyCertificate(certificate, encryption) {
  if (!certificate?.encryptedPayload) return null;
  if (!encryption?.isEncryptionAvailable()) throw new Error("Protecao do Windows indisponivel.");
  const saved = JSON.parse(encryption.decryptString(Buffer.from(certificate.encryptedPayload, "base64")));
  const pfx = Buffer.from(saved.pfx, "base64");
  try {
    const metadata = inspectStoredCertificate({ pfx, passphrase: saved.passphrase, fileName: certificate.fileName });
    return { pfx, passphrase: saved.passphrase, fileName: certificate.fileName, ...metadata };
  } catch (error) { pfx.fill(0); throw error; }
}
function publicCertificate(certificate) {
  if (!certificate) return undefined;
  const { fileName, commonName, validTo, fingerprint, cnpj } = certificate;
  return { fileName, commonName, validTo, fingerprint, ...(cnpj ? { cnpj } : {}) };
}
module.exports = { MAX_CERTIFICATE_BYTES, protectCompanyCertificate, restoreCompanyCertificate, publicCertificate };
