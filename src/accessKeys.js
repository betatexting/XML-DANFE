const ACCESS_KEY_LENGTH = 44;
const TOLERANT_ACCESS_KEY_PATTERN = /(?:^|[^\da-zA-Z])((?:\d[^\da-zA-Z]*){44})(?=$|[^\da-zA-Z])/gi;

function sanitizeAccessKeyCandidate(value) {
  return String(value).replace(/[^\d]+/g, "");
}

function collectTolerantMatches(rawValue) {
  const matches = [];

  for (const match of rawValue.matchAll(TOLERANT_ACCESS_KEY_PATTERN)) {
    const sanitized = sanitizeAccessKeyCandidate(match[1]);

    if (sanitized.length === ACCESS_KEY_LENGTH) {
      matches.push(sanitized);
    }
  }

  return matches;
}

function extractAccessKeys(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return [];
  }

  const exactMatches = rawValue.match(/\d{44}/g) ?? [];
  const tolerantMatches = collectTolerantMatches(rawValue);

  return [...new Set([...exactMatches, ...tolerantMatches])];
}

function getIssueMonthFromAccessKey(key) {
  const normalizedKey = sanitizeAccessKeyCandidate(key);
  if (normalizedKey.length !== ACCESS_KEY_LENGTH) {
    return "";
  }

  const year = Number.parseInt(normalizedKey.slice(2, 4), 10);
  const month = Number.parseInt(normalizedKey.slice(4, 6), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }

  return `${2000 + year}-${String(month).padStart(2, "0")}`;
}

function getIssueDateFromXml(xml) {
  const value = String(xml || "");
  const match = value.match(
    /<(?:\w+:)?(?:dhEmi|dEmi)\b[^>]*>\s*(\d{4}-\d{2}-\d{2}(?:T[^<\s]+)?)\s*<\/(?:\w+:)?(?:dhEmi|dEmi)>/i
  );

  return match?.[1] || "";
}

module.exports = {
  extractAccessKeys,
  getIssueDateFromXml,
  getIssueMonthFromAccessKey
};
