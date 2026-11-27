const RESIZE_EDGES = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function resizeBounds(start, cursor, edge, minimum, work) {
  if (!RESIZE_EDGES.has(edge)) throw new Error("Borda invalida.");
  const minWidth = Math.min(minimum[0], work.width);
  const minHeight = Math.min(minimum[1], work.height);
  const dx = cursor.x - start.cursor.x, dy = cursor.y - start.cursor.y;
  let left = start.bounds.x, top = start.bounds.y;
  let right = left + start.bounds.width, bottom = top + start.bounds.height;
  if (edge.includes("w")) left = clamp(left + dx, work.x, right - minWidth);
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth, work.x + work.width);
  if (edge.includes("n")) top = clamp(top + dy, work.y, bottom - minHeight);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, work.y + work.height);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

module.exports = { RESIZE_EDGES, resizeBounds };
