const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createCertificateQuota,HOUR_MS}=require('../src/certificateQuota');
const {processAccessKeysWithCertificate,processAccessKeysWithNsuDistribution}=require('../src/nfeDistribution');
const matrix='14078646000104';
const own='29261014078646000368550050000164641178815626';
const incoming='23261000954394000117550040040787401143425589';
test('point budget persists across instances, serializes reservations and respects a rolling hour and 656',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'certificate-quota-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const filePath=path.join(dir,'quota.json');let clock=10000000;
 const quota=createCertificateQuota({filePath,now:()=>clock});
 const allowed=await Promise.all(Array.from({length:23},()=>quota.acquire(matrix)));
 assert.equal(allowed.filter(Boolean).length,20);
 const restarted=createCertificateQuota({filePath,now:()=>clock});assert.equal(await restarted.acquire('14078646000368'),false);
 clock+=HOUR_MS+1;assert.equal(await restarted.acquire(matrix),true);
 await restarted.block(matrix);assert.equal(await restarted.acquire(matrix),false);
 clock+=HOUR_MS+1;assert.equal(await restarted.acquire(matrix),true);
});
test('mixed large block sends own invoices directly and incoming invoices to NSU without spending point calls',async()=>{
 const incomingKeys=Array.from({length:21},(_,i)=>incoming.slice(0,40)+String(i).padStart(4,'0'));
 const keys=[own,...incomingKeys];const stages=[];
 const results=await processAccessKeysWithCertificate({keys,certificate:{cnpj:matrix},
  withoutCertificateProcessor:async o=>{stages.push(['external',o.keys]);return o.keys.map(key=>({key,status:'success',lookupMode:'site-fallback'}));},
  nsuProcessor:async o=>{stages.push(['nsu',o.keys]);return o.keys.map(key=>({key,status:'success',lookupMode:'nfe-distribution-nsu'}));},
  soapRequest:async()=>assert.fail('no point request in bulk')});
 assert.equal(results.length,22);assert.deepEqual(stages.find(s=>s[0]==='external')[1],[own]);assert.equal(stages.find(s=>s[0]==='nsu')[1].length,21);
});
test('exhausted hourly budget avoids a real SOAP request and defers to NSU',async()=>{
 const [result]=await processAccessKeysWithCertificate({keys:[incoming],certificate:{cnpj:matrix},
 quota:{acquire:async()=>false},soapRequest:async()=>assert.fail('quota exhausted')});
 assert.equal(result.errorCode,'consulta_por_chave_limitada');
});
test('NSU partial scan reports a saved cursor rather than definitive absence',async()=>{
 let saved;const stateStore={readCachedXml:async()=>null,getDistributionState:async()=>({ultNsu:'000000000000000',maxNsu:'000000000000100'}),getLastNsu:async()=>0,
 deferNextNsuCheck:async()=>assert.fail('not at end'),saveCachedXml:async()=>{},saveLastNsu:async(cnpj,ult,max)=>{saved={cnpj,ult,max};}};
 const [result]=await processAccessKeysWithNsuDistribution({keys:[incoming],certificate:{cnpj:matrix},maxBatches:1,stateStore,
 soapRequest:async()=>'<retDistDFeInt><cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><ultNSU>50</ultNSU><maxNSU>100</maxNSU></retDistDFeInt>'});
 assert.equal(saved.cnpj,matrix);assert.equal(saved.ult,'000000000000050');assert.equal(result.errorCode,'nsu_varredura_parcial');assert.equal(result.sefaz.batchLimitReached,true);
});
test('NSU reaching max cursor establishes an hour wait before a new scan',async()=>{
 let deferred;const stateStore={readCachedXml:async()=>null,getDistributionState:async()=>({ultNsu:'000000000000000'}),getLastNsu:async()=>0,saveCachedXml:async()=>{},saveLastNsu:async()=>{},deferNextNsuCheck:async(cnpj,state)=>{deferred={cnpj,...state};}};
 await processAccessKeysWithNsuDistribution({keys:[incoming],certificate:{cnpj:matrix},stateStore,soapRequest:async()=>'<retDistDFeInt><cStat>138</cStat><ultNSU>50</ultNSU><maxNSU>50</maxNSU></retDistDFeInt>'});
 assert.equal(deferred.cnpj,matrix);assert.equal(deferred.delayMs,HOUR_MS);
});
