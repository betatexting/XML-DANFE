// Access keys identify emitters only. Incoming establishments are learned from XML.
function planCompanyBatch(keys, certificate) {
  const base = certificate.cnpj.slice(0, 8);
  const companies = new Set([certificate.cnpj, ...(certificate.companyCnpjs || [])]);
  for (const key of keys) {
    if (/^\d{44}$/.test(key) && key.slice(6, 14) === base) companies.add(key.slice(6, 20));
  }
  const cnpjs = [...companies].filter((cnpj) => /^\d{14}$/.test(cnpj) && cnpj.slice(0, 8) === base);
  if (Array.isArray(certificate.companyCnpjs)) certificate.companyCnpjs.splice(0, certificate.companyCnpjs.length, ...cnpjs);
  return {
    cnpjs,
    targetsFor(key) {
      const emitter = key.slice(6, 20);
      return emitter.slice(0, 8) === base ? [emitter] : cnpjs;
    }
  };
}

module.exports = { planCompanyBatch };
