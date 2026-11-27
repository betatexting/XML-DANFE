const test = require("node:test");
const assert = require("node:assert/strict");
const { parseXml } = require("../src/localXml");
const { buildBatchRequest, parseBatch } = require("../src/cteDistribution");

test("CT-e distribution uses the SOAP operation wrapper and reads the wrapped response", () => {
  const envelope = parseXml(buildBatchRequest("14078646000104", "000000000000000", 29));
  const operation = envelope.children[0].children[0];
  assert.equal(operation.name, "ctedistdfeinteresse");
  assert.equal(operation.children[0].name, "ctedadosmsg");
  assert.equal(operation.children[0].children[0].name, "distdfeint");

  const response = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>
    <cteDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">
      <cteDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/cte">
        <cStat>137</cStat><ultNSU>0</ultNSU><maxNSU>0</maxNSU>
      </retDistDFeInt></cteDistDFeInteresseResult>
    </cteDistDFeInteresseResponse>
  </soap:Body></soap:Envelope>`;
  assert.deepEqual(parseBatch(response, "14078646000104"), {
    status: "137", reason: "", last: "000000000000000", max: "000000000000000", documents: [], skipped: 0
  });
});
