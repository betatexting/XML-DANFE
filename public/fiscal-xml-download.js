export async function downloadFiscalXml(companyId, type, month, format = "zip") {
  const query = new URLSearchParams({ type, month, format });
  const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/fiscal-xml/archive?${query}`);
  if (!response.ok) throw new Error((await response.json()).error);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = format === "keys" ? `chaves-${type}-${month}.txt` : `xml-${type}-${month || "todos-os-meses"}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
