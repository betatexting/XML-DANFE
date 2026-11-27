const { getIssueMonthFromAccessKey } = require("./accessKeys");

function cteDirection(roles) {
  if (roles.includes("tomadora")) return "tomadas";
  if (roles.includes("remetente")) return "saidas";
  if (roles.includes("destinataria")) return "entradas";
  return "sem-classificacao";
}

function fiscalArchivePath({ document, type, date, direction, key, filename = key }) {
  const datePeriod = String(date || "").slice(0, 7);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(datePeriod) ? datePeriod :
    /^\d{44}$/.test(key) ? getIssueMonthFromAccessKey(key) : "";
  const [year, month] = period ? period.split("-") : ["sem-ano", "sem-mes"];
  return `${document}/${type}/${year}/${month}/${direction || "sem-classificacao"}/${filename}.xml`;
}

module.exports = { cteDirection, fiscalArchivePath };
