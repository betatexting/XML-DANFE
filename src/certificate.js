const tls = require("tls");
const { X509Certificate } = require("crypto");

const CNPJ_OTHER_NAME_OID = Buffer.from([0x06, 0x05, 0x60, 0x4c, 0x01, 0x03, 0x03]);

class CertificateError extends Error {
  constructor(message, code = "certificado_invalido") {
    super(message);
    this.name = "CertificateError";
    this.code = code;
  }
}

function readDerElement(buffer, offset) {
  if (offset >= buffer.length) {
    return null;
  }

  const tag = buffer[offset];
  let lengthOffset = offset + 1;

  if (lengthOffset >= buffer.length) {
    return null;
  }

  let length = buffer[lengthOffset];
  lengthOffset += 1;

  if (length & 0x80) {
    const byteCount = length & 0x7f;

    if (byteCount === 0 || byteCount > 4 || lengthOffset + byteCount > buffer.length) {
      return null;
    }

    length = 0;
    for (let index = 0; index < byteCount; index += 1) {
      length = (length << 8) | buffer[lengthOffset + index];
    }
    lengthOffset += byteCount;
  }

  const end = lengthOffset + length;
  if (end > buffer.length) {
    return null;
  }

  return {
    tag,
    valueStart: lengthOffset,
    end
  };
}

function readCnpjExtension(rawCertificate) {
  let searchOffset = 0;

  while (searchOffset < rawCertificate.length) {
    const oidOffset = rawCertificate.indexOf(CNPJ_OTHER_NAME_OID, searchOffset);
    if (oidOffset === -1) {
      return "";
    }

    const oid = readDerElement(rawCertificate, oidOffset);
    if (!oid || oid.tag !== 0x06) {
      searchOffset = oidOffset + 1;
      continue;
    }

    const otherNameValue = rawCertificate
      .subarray(oid.end, Math.min(rawCertificate.length, oid.end + 96))
      .toString("latin1");
    const otherNameCnpj = otherNameValue.match(/\d{14}/)?.[0] ?? "";
    if (otherNameCnpj) {
      return otherNameCnpj;
    }

    let cursor = oid.end;
    let extension = readDerElement(rawCertificate, cursor);

    if (extension?.tag === 0x01) {
      cursor = extension.end;
      extension = readDerElement(rawCertificate, cursor);
    }

    if (extension?.tag === 0x04) {
      const extensionText = rawCertificate
        .subarray(extension.valueStart, extension.end)
        .toString("latin1");
      const cnpj = extensionText.match(/\d{14}/)?.[0] ?? "";

      if (cnpj) {
        return cnpj;
      }
    }

    searchOffset = oid.end;
  }

  return "";
}

function getCommonName(subject) {
  const match = String(subject || "").match(/(?:^|\n)CN\s*=\s*([^\n]+)/i);
  return match?.[1]?.trim() || "";
}

function getStateFromSubject(subject) {
  const match = String(subject || "").match(/(?:^|\n)ST\s*=\s*([^\n]+)/i);
  return match?.[1]?.trim() || "";
}

function inspectCertificate({ pfx, passphrase = "", requireCnpj = true }) {
  if (!Buffer.isBuffer(pfx) || pfx.length === 0) {
    throw new CertificateError("Selecione um certificado A1 valido em formato .pfx ou .p12.");
  }

  let secureContext;

  try {
    secureContext = tls.createSecureContext({
      pfx,
      passphrase
    });
  } catch (_error) {
    throw new CertificateError(
      "Nao foi possivel abrir o certificado. Verifique a senha e o arquivo selecionado."
    );
  }

  const rawCertificate = secureContext.context.getCertificate();
  if (!Buffer.isBuffer(rawCertificate) || rawCertificate.length === 0) {
    throw new CertificateError(
      "O certificado selecionado nao possui a chave privada necessaria para a consulta."
    );
  }

  let certificate;
  try {
    certificate = new X509Certificate(rawCertificate);
  } catch (_error) {
    throw new CertificateError("Nao foi possivel ler os dados do certificado selecionado.");
  }

  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  if (!Number.isFinite(validFrom.getTime()) || validFrom.getTime() > Date.now()) {
    throw new CertificateError(
      "O certificado selecionado ainda nao esta valido.",
      "certificado_ainda_nao_valido"
    );
  }

  if (!Number.isFinite(validTo.getTime()) || validTo.getTime() < Date.now()) {
    throw new CertificateError("O certificado selecionado esta vencido.", "certificado_vencido");
  }

  const cnpj = readCnpjExtension(rawCertificate);
  if (!cnpj && requireCnpj) {
    throw new CertificateError(
      "O certificado nao possui um CNPJ na extensao exigida pela SEFAZ. Selecione um e-CNPJ A1 valido.",
      "certificado_sem_cnpj"
    );
  }

  return {
    cnpj,
    cnpjBase: cnpj.slice(0, 8),
    commonName: getCommonName(certificate.subject),
    state: getStateFromSubject(certificate.subject),
    validTo: validTo.toISOString(),
    fingerprint: certificate.fingerprint256
  };
}

function formatCnpj(cnpj) {
  const value = String(cnpj || "").replace(/\D/g, "");
  if (value.length !== 14) {
    return value;
  }

  return value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

module.exports = {
  CertificateError,
  formatCnpj,
  inspectCertificate
};
