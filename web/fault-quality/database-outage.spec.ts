import { test,expect,type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
const api="http://localhost:8082",control="http://127.0.0.1:18090";
async function call<T>(client:APIRequestContext,path:string,method="GET",data?:unknown):Promise<T>{
  const headers:Record<string,string>={};
  if(method!=="GET")headers["X-XSRF-TOKEN"]=(await(await client.get(api+"/api/auth/csrf")).json()).token;
  const response=await client.fetch(api+path,{method,headers,data});
  expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);
  return response.status()===204?undefined as T:await response.json();
}
test("数据库不可用时消息草稿不得被当作成功清空",async({page},testInfo)=>{
  const run=JSON.parse(readFileSync("../reports/quality-2026-11-08-round3/resilience.json","utf8"));
  expect(run.soak.summary?.actualSeconds,"Do not interrupt an unfinished soak").toBeGreaterThanOrEqual(1800);
  // Only this browser's API traffic is forwarded to the disposable test instance.
  await page.route("http://localhost:8080/api/**",route=>route.continue({url:route.request().url().replace("http://localhost:8080",api)}));
  await page.goto("/");
  await page.getByRole("button",{name:"注册",exact:true}).click();
  await page.getByLabel("邮箱").fill(`db-fault-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill("隔离故障用户");
  await page.getByLabel("密码").fill("DatabaseFault123!");
  await page.getByRole("button",{name:"注册并登录"}).click();
  await expect(page).toHaveURL(/\/patient$/);
  const entry=await call<{entryId:string}>(page.request,"/api/indicators","POST",{category:"BP",context:"HOME",ageYears:22,pregnant:false,measuredAt:new Date(Date.now()-60000).toISOString().slice(0,19),values:{systolic_bp:{value:125,unit:"mmHg"},diastolic_bp:{value:80,unit:"mmHg"}}});
  const report=await call<{id:number}>(page.request,"/api/reports","POST",{entryId:entry.entryId});
  const grant=await call<{doctorId:number}>(page.request,`/api/reports/${report.id}/grants`,"POST",{doctorEmail:"doctor@jwzz.local"});
  const chat=await call<{id:number}>(page.request,"/api/consultations","POST",{reportId:report.id,doctorId:grant.doctorId,question:"数据库故障测试首消息"});
  await Promise.all([
    page.waitForResponse(response=>response.url().endsWith(`/api/messages/conversations/${chat.id}/read`) && response.request().method()==="POST" && response.ok()),
    page.goto(`/patient/messages?conversation=${chat.id}`),
  ]);
  await expect(page.locator(".chat-thread .chat-row")).toHaveCount(1);
  const body="故障期间不应丢失的草稿";
  try{
    await page.request.post(control+"/mysql/down");
    await page.getByLabel("输入消息",{exact:true}).fill(body);
    const [response]=await Promise.all([
      page.waitForResponse(response=>response.url().endsWith(`/api/messages/conversations/${chat.id}`) && response.request().method()==="POST"),
      page.getByRole("button",{name:"发送",exact:true}).click(),
    ]);
    await testInfo.attach("write-response",{body:JSON.stringify({status:response.status(),length:(await response.text()).length}),contentType:"application/json"});
    await expect(page.locator(".chat-toast")).toBeVisible();
    await expect(page.getByLabel("输入消息",{exact:true})).toHaveValue(body);
  }finally{
    await page.request.post(control+"/mysql/up");
    await expect.poll(async()=> (await page.request.get(api+`/api/messages/conversations/${chat.id}`)).status(),{timeout:20000}).toBe(200);
    const detail=await call<{messages:{body:string}[]}>(page.request,`/api/messages/conversations/${chat.id}`);
    const persisted=detail.messages.filter(message=>message.body===body).length;
    await testInfo.attach("persistence-after-recovery",{body:JSON.stringify({conversationId:chat.id,persisted}),contentType:"application/json"});
    expect(persisted).toBe(0);
    await call(page.request,`/api/reports/${report.id}/grants/${grant.doctorId}`,"DELETE");
  }
});
test("数据库不可用时商家消息草稿不得被当作成功清空",async({page,browser},testInfo)=>{
  const run=JSON.parse(readFileSync("../reports/quality-2026-11-08-round3/resilience.json","utf8"));
  expect(run.soak.summary?.actualSeconds).toBeGreaterThanOrEqual(1800);
  await page.route("http://localhost:8080/api/**",route=>route.continue({url:route.request().url().replace("http://localhost:8080",api)}));
  const merchantContext=await browser.newContext(),merchant=merchantContext.request;
  const suffix=Date.now(),password="DatabaseFault123!";
  for(const [client,role] of [[page.request,"USER"],[merchant,"MERCHANT"]] as const){
    const email=`db-fault-${role}-${suffix}@example.invalid`;
    await call(client,"/api/auth/register","POST",{email,password,name:"隔离故障测试",role});
    const token=(await(await client.get(api+"/api/auth/csrf")).json()).token;
    expect((await client.post(api+"/api/auth/login",{headers:{"X-XSRF-TOKEN":token},form:{email,password}})).ok()).toBe(true);
  }
  await call(merchant,"/api/merchant/store","POST",{name:"浏览器故障测试店",city:"武汉",address:"虚构地址"});
  const product=(await call<{id:number}[]>(merchant,"/api/merchant/products"))[0];
  await call(merchant,`/api/merchant/products/${product.id}/inventory`,"PUT",{available:1,note:"故障测试"});
  await call(merchant,`/api/merchant/products/${product.id}/status`,"PUT",{status:"ON_SHELF"});
  await call(merchant,"/api/merchant/store/status","PUT",{status:"OPEN"});
  await call(page.request,"/api/shop/cart/items","POST",{skuId:product.id,quantity:1});
  const order=await call<{order:{id:number}}>(page.request,"/api/shop/orders","POST",{idempotencyKey:crypto.randomUUID()});
  const chat=await call<{conversation:{id:number}}>(page.request,`/api/shop/orders/${order.order.id}/conversation`,"POST",{});
  const endpoint=`/api/shop/conversations/${chat.conversation.id}`,body="商家故障期间不应丢失的草稿";
  await Promise.all([page.waitForResponse(r=>r.url().endsWith(endpoint+"/read")&&r.request().method()==="POST"&&r.ok()),page.goto(`/patient/shop-messages?conversation=${chat.conversation.id}`)]);
  try{
    await page.request.post(control+"/mysql/down");
    await page.getByLabel("输入商家消息").fill(body);
    const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(endpoint+"/messages")&&r.request().method()==="POST"),page.getByRole("button",{name:"发送",exact:true}).click()]);
    await testInfo.attach("write-response",{body:JSON.stringify({status:response.status(),length:(await response.text()).length}),contentType:"application/json"});
    await expect(page.locator(".chat-toast")).toBeVisible();
    await expect(page.getByLabel("输入商家消息")).toHaveValue(body);
  }finally{
    await page.request.post(control+"/mysql/up");
    await expect.poll(async()=>(await page.request.get(api+endpoint)).status(),{timeout:20000}).toBe(200);
    const detail=await call<{messages:{body:string}[]}>(page.request,endpoint);
    const persisted=detail.messages.filter(m=>m.body===body).length;
    await testInfo.attach("persistence-after-recovery",{body:JSON.stringify({conversationId:chat.conversation.id,persisted}),contentType:"application/json"});
    expect(persisted).toBe(0);
    await call(page.request,`/api/shop/orders/${order.order.id}/cancel`,"POST");
    await call(merchant,"/api/merchant/store/status","PUT",{status:"DRAFT"});
    await merchantContext.close();
  }
});
