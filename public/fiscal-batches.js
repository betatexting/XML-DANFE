// Each adapter supplies its continuation rule; transport failures are never retried here.
export async function* fiscalBatches({ request, next, cursor, isActive = () => true, pause = 1000 }) {
  const visited = new Set();
  while (isActive()) {
    if (visited.has(String(cursor))) throw new Error("A consulta retornou uma sequência repetida. Progresso preservado.");
    visited.add(String(cursor));
    const data = await request(cursor);
    if (!isActive()) return;
    yield { data, cursor };
    const continuation = next(data, cursor);
    if (continuation === null || continuation === undefined || continuation === false) return;
    cursor = continuation;
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
}
