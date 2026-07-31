function extractAccessKeys(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return [];
  }

  const normalized = rawValue.replace(/[^\d]+/g, "\n");
  const tokens = normalized
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length === 44);

  return [...new Set(tokens)];
}

module.exports = {
  extractAccessKeys
};
