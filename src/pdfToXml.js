const pdfParse = require("pdf-parse");
const { extractAccessKeys } = require("./accessKeys");

async function extractCandidatesFromPdfFiles(files) {
  const candidates = [];

  for (const file of files) {
    try {
      const data = await pdfParse(file.buffer);
      const keys = extractAccessKeys(data.text);

      if (keys.length === 0) {
        candidates.push({
          sourceName: file.originalname,
          status: "error",
          message:
            "Nao foi possivel localizar uma chave de 44 digitos neste PDF. Se ele for escaneado como imagem, sera preciso OCR."
        });
        continue;
      }

      for (const key of keys) {
        candidates.push({
          sourceName: file.originalname,
          key,
          status: "pending"
        });
      }
    } catch (error) {
      candidates.push({
        sourceName: file.originalname,
        status: "error",
        message: error.message || "Falha ao ler o PDF enviado."
      });
    }
  }

  return candidates;
}

module.exports = {
  extractCandidatesFromPdfFiles
};
