const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { planCompanyBatch } = require('../src/companyBatch');
const { classifyXml, saveOrganizedXml, getCertificateOrganization } = require('../src/xmlStorage');
const { isFallbackEligibleResult } = require('../src/lookupResult');
const { processAccessKeysWithCertificate, processAccessKeysWithNsuDistribution } = require('../src/nfeDistribution');
const matrix='14078646000104', branch='14078646000368', branch4='14078646000449', supplier='00954394000117';
const incoming='23261000954394000117550040040787401143425589';
const outgoing='29261014078646000368550050000164641178815626';
const xml=(emit,dest,key=incoming)=>`<nfeProc><NFe><infNFe Id="NFe${key}"><ide><dhEmi>2026-10-09T12:00:00-03:00</dhEmi></ide><emit><CNPJ>${emit}</CNPJ></emit><dest><CNPJ>${dest}</CNPJ></dest></infNFe></NFe></nfeProc>`;
const response=x=>`<retDistDFeInt><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><loteDistDFeInt><docZip schema="procNFe_v4.00.xsd">${zlib.gzipSync(x).toString('base64')}</docZip></loteDistDFeInt></retDistDFeInt>`;
async function directory(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'family-xml-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
test('mixed block identifies company emitters without mistaking suppliers for branches',()=>{
 const certificate={cnpj:matrix,companyCnpjs:[matrix,'11111111000111']};
 const plan=planCompanyBatch([incoming,outgoing],certificate);
 assert.deepEqual(plan.cnpjs,[matrix,branch]);assert.deepEqual(plan.targetsFor(outgoing),[branch]);assert.deepEqual(plan.targetsFor(incoming),[matrix,branch]);
});
test('family classification covers incoming and outgoing from both branches and rejects other companies',()=>{
 const org=getCertificateOrganization({cnpj:matrix});
 for(const cnpj of [matrix,branch,branch4]){
  assert.equal(classifyXml(xml(supplier,cnpj),incoming,org).cnpj,cnpj);
  assert.equal(classifyXml(xml(supplier,cnpj),incoming,org).type,'entradas');
  assert.equal(classifyXml(xml(cnpj,supplier),incoming,org).type,'saidas');
 }
 assert.throws(()=>classifyXml(xml(supplier,'11111111000111'),incoming,org),/filiais/);
});
test('reuses existing branch folders and keeps identical duplicates and different versions safely',async t=>{
 const d=await directory(t),org=getCertificateOrganization({cnpj:matrix});
 const existing=path.join(d,branch,'2026-10','entradas');await fs.mkdir(existing,{recursive:true});
 const original=xml(supplier,branch);const first=await saveOrganizedXml(original,incoming,d,org);
 assert.equal(path.dirname(first),existing);assert.equal(await saveOrganizedXml(original,incoming,d,org),first);
 const other=await saveOrganizedXml(original.replace('12:00:00','13:00:00'),incoming,d,org);
 assert.notEqual(first,other);assert.equal(await fs.readFile(first,'utf8'),original+'\n');assert.equal((await fs.readdir(existing)).length,2);
});
test('certificate returned branch XML is saved for the branch without triggering fallback',async t=>{
 const d=await directory(t);let calls=0;
 const [result]=await processAccessKeysWithCertificate({keys:[incoming],downloadsDir:d,certificate:{cnpj:matrix,companyCnpjs:[matrix]},soapRequest:async()=>{calls++;return response(xml(supplier,branch));}});
 assert.equal(calls,1);assert.equal(result.status,'success');assert.equal(result.companyCnpj,branch);assert.equal(result.invoiceType,'entradas');assert.equal(result.interestedCnpj,matrix);assert.match(result.filePath,/14078646000368/);
});
test('certificate targets an identified branch and retries incoming only on absence with a known branch',async t=>{
 const d=await directory(t),targets=[];const cert={cnpj:matrix,companyCnpjs:[matrix,branch]};
 const results=await processAccessKeysWithCertificate({keys:[incoming,outgoing],downloadsDir:d,certificate:cert,withoutCertificateProcessor:async ({keys})=>keys.map(key=>({key,status:'success',lookupMode:'site-fallback'})),soapRequest:async({body,certificate})=>{
  assert.equal(certificate.cnpj,matrix);const target=body.match(/<CNPJ>(\d+)<\/CNPJ>/)[1];targets.push(target);
  if(target===matrix)return '<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo></retDistDFeInt>';
  const key=body.match(/<chNFe>(\d+)<\/chNFe>/)[1];return response(xml(key===outgoing?branch:supplier,key===outgoing?supplier:branch,key));
 }});
 assert.deepEqual(targets,[matrix,branch]);assert.ok(results.every(r=>r.status==='success'));assert.equal(results[0].initialError.errorCode,'certificado_sem_autorizacao');
});
test('local classification failure does not retry another establishment or qualify for fallback',async t=>{
 const d=await directory(t);let calls=0;
 const [result]=await processAccessKeysWithCertificate({keys:[incoming],downloadsDir:d,certificate:{cnpj:matrix,companyCnpjs:[matrix,branch]},soapRequest:async()=>{calls++;return response(xml(supplier,'11111111000111'));}});
 assert.equal(calls,1);assert.equal(result.errorCode,'xml_organization_failed');assert.equal(isFallbackEligibleResult(result),false);assert.equal(result.sefaz.cStat,'138');
});
test('NSU fallback uses distinct establishment targets and does not query successful keys again',async()=>{
 const calls=[];const certificate={cnpj:matrix,companyCnpjs:[matrix,branch]};
 const results=await processAccessKeysWithNsuDistribution({keys:[incoming,outgoing],certificate,processCompany:async o=>{calls.push({target:o.interestedCnpj,keys:o.keys});assert.equal(o.certificate.cnpj,matrix);return o.keys.map(key=>({key,status:o.interestedCnpj===branch?'success':'error',errorCode:'documento_nsu_nao_localizado'}));}});
 assert.deepEqual(calls.map(c=>c.target),[matrix,branch]);assert.equal(results[0].status,'success');assert.equal(results[1].errorCode,'emissao_propria_fonte_externa');
});
