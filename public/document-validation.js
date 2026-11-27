/* Local check digits only; no registry, ownership or registration-status lookup.
 * CPF/CEI/CAEPF: ANS SIB-XML algorithms (17/01/2019).
 * CNPJ numeric/alphanumeric: Receita Federal, CNPJ Alfanumerico Q&A, item 14.
 */
(() => {
  function normalizeDocument(value) {
    return typeof value === "string" ? value.trim().replace(/[.\/\-\s]/g, "").toUpperCase() : "";
  }
  function modulo11(sum) { const rest = sum % 11; return rest < 2 ? 0 : 11 - rest; }
  function companyDigit(base) {
    let sum = 0, weight = 2;
    for (let index = base.length - 1; index >= 0; index--) {
      sum += (base.charCodeAt(index) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    return modulo11(sum);
  }
  function companyDigits(base) {
    const first = companyDigit(base);
    return `${first}${companyDigit(base + first)}`;
  }
  function validDigits(type, number) {
    if (/^(\d)\1+$/.test(number)) return false;
    if (type === "cnpj") return companyDigits(number.slice(0, 12)) === number.slice(12);
    if (type === "cpf") {
      const digit = (base) => modulo11([...base].reduce((sum, char, index) => sum + Number(char) * (base.length + 1 - index), 0));
      const base = number.slice(0, 9), first = digit(base);
      return `${first}${digit(base + first)}` === number.slice(9);
    }
    if (type === "cei") {
      if (number.startsWith("0000000000")) return false;
      const weights = [7, 4, 1, 8, 5, 2, 1, 6, 3, 7, 4];
      const sum = weights.reduce((total, weight, index) => total + weight * Number(number[index]), 0);
      return (10 - ((sum % 10 + Math.floor(sum / 10)) % 10)) % 10 === Number(number[11]);
    }
    const base = number.slice(0, 12);
    if (/^(\d)\1+$/.test(base)) return false;
    return String((Number(companyDigits(base)) + 12) % 100).padStart(2, "0") === number.slice(12);
  }
  function validateDocument(type, value) {
    const number = normalizeDocument(value), labels = { cnpj: "CNPJ", cpf: "CPF", cei: "CEI", caepf: "CAEPF" };
    const label = typeof type === "string" && Object.hasOwn(labels, type) ? labels[type] : null;
    if (!label) return { valid: false, number, message: "Selecione o tipo de documento." };
    const format = type === "cnpj" ? /^[A-Z0-9]{12}\d{2}$/ : type === "cpf" ? /^\d{11}$/ : type === "cei" ? /^\d{12}$/ : /^\d{14}$/;
    if (typeof value !== "string" || !/^[A-Za-z0-9.\/\-\s]+$/.test(value) || !format.test(number)) return { valid: false, number, message: `${label}: confira o número de caracteres e o formato informado.` };
    if (!validDigits(type, number)) return { valid: false, number, message: `${label} inválido. Confira os dígitos verificadores.` };
    return { valid: true, number, message: "" };
  }
  const api = Object.freeze({ normalizeDocument, validateDocument });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.CompanyDocumentValidation = api;
})();
