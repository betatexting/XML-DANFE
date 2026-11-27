const tls = require("tls");
const fs = require("fs/promises");
const path = require("path");
const { X509Certificate, createHash } = require("crypto");
const SEFAZ_HOST = "nfe.sefaz.ba.gov.br";
const ICP_ROOT_SHA256 = "6E0BFF069A26994C15DE2C4888CC54AF84882E5495B7FBF66BE9CCFFEC7489F6";
async function loadIcpRoot() {
  const pem = await fs.readFile(path.join(__dirname, "certificates", "icp-brasil-v10.pem"), "utf8");
  const certificate = new X509Certificate(pem);
  if (certificate.fingerprint256.replace(/:/g, "") !== ICP_ROOT_SHA256 || !certificate.ca || !certificate.verify(certificate.publicKey)) throw new Error("invalid_icp_trust_anchor");
  return pem;
}
function verifyTlsEndpoint({ host, port = 443, servername = host, ca, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; socket.destroy(); if (error) reject(error); else resolve(result);
    };
    const socket = tls.connect({ host, port, servername, ca, rejectUnauthorized: true }, () => {
      try {
        if (!socket.authorized) throw new Error("tls_not_authorized");
        const certificate = new X509Certificate(socket.getPeerCertificate().raw);
        if (!certificate.checkHost(servername)) throw new Error("tls_hostname_mismatch");
        const spki = createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
        finish(null, { host: servername, spki, fingerprint256: certificate.fingerprint256, validTo: certificate.validTo, verifiedAt: new Date().toISOString() });
      } catch (error) { finish(error); }
    });
    socket.setTimeout(timeout, () => finish(Object.assign(new Error("TLS validation timed out"), { code: "TLS_VALIDATION_TIMEOUT" })));
    socket.on("error", (error) => finish(error));
  });
}
async function verifySefazTlsTrust() {
  const root = await loadIcpRoot();
  return verifyTlsEndpoint({ host: SEFAZ_HOST, ca: [...tls.rootCertificates, root] });
}
module.exports = { SEFAZ_HOST, ICP_ROOT_SHA256, loadIcpRoot, verifyTlsEndpoint, verifySefazTlsTrust };
