import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
const base='http://127.0.0.1:8082', control='http://127.0.0.1:18090';
const directory='reports/quality-2026-11-08-round3';
const seconds=Number(process.env.QA_SOAK_SECONDS ?? 1800);
assert(Number.isInteger(seconds) && seconds>=60 && seconds<=3600);
mkdirSync(directory,{recursive:true});
const results={startedAt:new Date().toISOString(),faults:[],soak:{seconds,samples:[],resources:[]}};
function save(){writeFileSync(`${directory}/resilience.json`,JSON.stringify(results,null,2));}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function mode(service,state){const r=await fetch(`${control}/${service}/${state}`,{method:'POST'});assert.equal(r.status,200);}
class Client {
  cookies=new Map();
  async raw(path,method='GET',data){
    const headers={Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(method!=='GET' && path!=='/api/auth/login') headers['X-XSRF-TOKEN']=(await this.json('/api/auth/csrf')).token;
    headers.Cookie=[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    let body;
    if(data!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(data);}
    if(path==='/api/auth/login'){
      headers['X-XSRF-TOKEN']=(await this.json('/api/auth/csrf')).token;
      headers.Cookie=[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
      headers['Content-Type']='application/x-www-form-urlencoded';body=new URLSearchParams(data).toString();
    }
    const response=await fetch(base+path,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(15000)});
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const split=pair.indexOf('=');this.cookies.set(pair.slice(0,split),pair.slice(split+1));}
    const text=await response.text();let payload;try{payload=JSON.parse(text);}catch{payload=text;}
    return {status:response.status,payload,location:response.headers.get('location')};
  }
  async json(path,method='GET',data){const r=await this.raw(path,method,data);assert(r.status>=200&&r.status<300,`${method} ${path} returned ${r.status}`);return r.payload;}
  async register(role){const email=`qa-resilience-${role}-${crypto.randomUUID()}@example.invalid`,password='QualityResilience123!';await this.json('/api/auth/register','POST',{email,password,name:'隔离测试',role});await this.json('/api/auth/login','POST',{email,password});return this.json('/api/auth/me');}
}
const user=new Client(),merchant=new Client();let order,store,chat;
try{
  await user.register('USER');await merchant.register('MERCHANT');
  store=await merchant.json('/api/merchant/store','POST',{name:'隔离故障测试店',city:'武汉',address:'虚构地址'});
  const product=(await merchant.json('/api/merchant/products'))[0];
  await merchant.json(`/api/merchant/products/${product.id}/inventory`,'PUT',{available:1,note:'隔离故障测试'});
  await merchant.json(`/api/merchant/products/${product.id}/status`,'PUT',{status:'ON_SHELF'});
  await merchant.json('/api/merchant/store/status','PUT',{status:'OPEN'});
  await user.json('/api/shop/cart/items','POST',{skuId:product.id,quantity:1});
  order=await user.json('/api/shop/orders','POST',{idempotencyKey:crypto.randomUUID()});
  chat=await user.json(`/api/shop/orders/${order.order.id}/conversation`,'POST',{body:'隔离测试首消息'});
  const endpoint=`/api/shop/conversations/${chat.conversation.id}`,send=endpoint+'/messages';
  const catalog=await user.json('/api/public/indicators');
  await mode('redis','down');
  const redisStarted=performance.now();
  assert.deepEqual(await user.json('/api/public/indicators'),catalog);
  // This fresh merchant has sent no messages before the outage.
  let blocked=0;
  if(Date.now()%60000>45000) await sleep(60000-Date.now()%60000+100);
  for(let i=0;i<61;i++){
    const r=await merchant.raw(`/api/merchant/conversations/${chat.conversation.id}/messages`,'POST',{body:`降级计数 ${i}`,clientMessageId:crypto.randomUUID()});
    if(i<60)assert.equal(r.status,201);else{assert.equal(r.status,429);blocked++;}
  }
  results.faults.push({scenario:'redis-down',catalog:'same-content-200',allowed:60,blocked,elapsedMs:Math.round(performance.now()-redisStarted)});save();
  await mode('redis','up');
  assert.deepEqual(await user.json('/api/public/indicators'),catalog);
  await user.json(send,'POST',{body:'Redis恢复后消息',clientMessageId:crypto.randomUUID()});
  results.faults.push({scenario:'redis-restored',status:'catalog-and-send-recovered'});save();
  const key=crypto.randomUUID(),body='数据库恢复后仅一次';
  await mode('mysql','down');
  const dbStarted=performance.now();
  const read=await user.raw('/api/indicators');assert(read.status>=500);
  const write=await user.raw(send,'POST',{body,clientMessageId:key});
  results.faults.push({scenario:'mysql-down-write-probe',status:write.status,bodyType:typeof write.payload,preview:typeof write.payload==='string'?write.payload.slice(0,200):undefined,location:write.location,errorContractPassed:write.status>=500});save();
  const liveness=await user.raw('/api/health');assert.equal(liveness.status,200);
  results.faults.push({scenario:'mysql-down',readStatus:read.status,writeStatus:write.status,livenessStatus:liveness.status,elapsedMs:Math.round(performance.now()-dbStarted)});save();
  await mode('mysql','up');
  let recovered=false;
  for(let i=0;i<15;i++){if((await user.raw('/api/indicators')).status===200){recovered=true;break;}await sleep(1000);}assert(recovered);
  assert.equal((await user.json(endpoint)).messages.filter(m=>m.body===body).length,0,'outage write must not be silently committed');
  await user.json(send,'POST',{body,clientMessageId:key});await user.json(send,'POST',{body,clientMessageId:key});
  assert.equal((await user.json(endpoint)).messages.filter(m=>m.body===body).length,1);
  results.faults.push({scenario:'mysql-restored',replayedMessageCount:1});save();
  console.log('FAULT CHECKS FINISHED; error-contract findings retained; starting bounded soak');
  const routes=['/api/health','/api/public/indicators','/api/indicators','/api/shop/conversations',endpoint];
  const began=performance.now();let lastResource=-60;
  while(performance.now()-began<seconds*1000){
    const tick=performance.now();
    const samples=await Promise.all(routes.map(async path=>{const start=performance.now();try{const r=await user.raw(path);return{path,status:r.status,ms:Math.round((performance.now()-start)*10)/10};}catch(error){return{path,status:0,error:error.name,ms:Math.round(performance.now()-start)};}}));
    results.soak.samples.push(...samples);
    const elapsed=Math.floor((performance.now()-began)/1000);
    if(elapsed-lastResource>=60){
      lastResource=elapsed;
      const pid=process.env.QA_BACKEND_PID;
      if(pid && /^\d+$/.test(pid)){
        try{const resource=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',`Get-Process -Id ${pid} | Select-Object CPU,WorkingSet64,PrivateMemorySize64,HandleCount | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));results.soak.resources.push({elapsed,...resource});}catch{results.soak.resources.push({elapsed,error:'process-sample-failed'});}
      }
      save();console.log(`SOAK ${elapsed}s/${seconds}s samples=${results.soak.samples.length} non200=${results.soak.samples.filter(r=>r.status!==200).length}`);
    }
    await sleep(Math.max(0,2000-(performance.now()-tick)));
  }
  const latencies=results.soak.samples.map(r=>r.ms).sort((a,b)=>a-b);
  results.soak.summary={requests:latencies.length,non200:results.soak.samples.filter(r=>r.status!==200).length,p95Ms:latencies[Math.ceil(latencies.length*.95)-1],actualSeconds:Math.round((performance.now()-began)/1000)};
  assert.equal(results.soak.summary.non200,0);console.log('SOAK PASSED',JSON.stringify(results.soak.summary));
  if(results.faults.some(f=>f.errorContractPassed===false)) { results.openFindings=['mysql-outage-write-error-contract']; process.exitCode=1; }
}catch(error){results.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.message);}
finally{
  await mode('mysql','up').catch(()=>{});await mode('redis','up').catch(()=>{});
  try{if(order)await user.json(`/api/shop/orders/${order.order.id}/cancel`,'POST');if(store)await merchant.json('/api/merchant/store/status','PUT',{status:'DRAFT'});results.cleanup={orderCancelled:!!order,storePaused:!!store};}catch(error){results.cleanup={error:error.message};process.exitCode=1;}
  results.finishedAt=new Date().toISOString();save();
}
