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

module.exports = {
  extractAccessKeys
};
