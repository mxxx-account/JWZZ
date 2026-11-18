import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
const base=process.env.TEST_API_URL??"http://localhost:8080";
async function csrf(client:APIRequestContext) {return (await (await client.get(`${base}/api/auth/csrf`)).json()).token;}
async function call<T=void>(client:APIRequestContext,path:string,method="GET",data?:unknown):Promise<T> {
  const result=await client.fetch(`${base}/api${path}`,{method,data,headers:method==="GET"?undefined:{"X-XSRF-TOKEN":await csrf(client)}});
  expect(result.ok(),`${method} ${path}: ${result.status()} ${await result.text()}`).toBe(true);
  return result.status()===204?undefined as T:await result.json();
}
async function register(client:APIRequestContext,role:string) {
  const email=`followup-${role}-${randomUUID()}@example.invalid`,password="SyntheticFollowup123!";
  await call(client,"/auth/register","POST",{email,password,name:"随访测试",role,specialty:role==="DOCTOR"?"GENERAL":undefined});
  expect((await client.post(`${base}/api/auth/login`,{headers:{"X-XSRF-TOKEN":await csrf(client)},form:{email,password}})).ok()).toBe(true);return email;
}
async function report(client:APIRequestContext) {
  const record=await call<{entryId:string}>(client,"/indicators","POST",{category:"BP",measuredAt:"2026-01-02T10:00:00",context:"HOME",ageYears:22,pregnant:false,values:{systolic_bp:{value:130,unit:"mmHg"},diastolic_bp:{value:80,unit:"mmHg"}}});
  return (await call<{id:number}>(client,"/reports","POST",{entryId:record.entryId})).id;
}

test("随访真实流程：医生结束、用户确认、报告逐份授权和撤权",async({page,browser},info)=>{
  const doctor=await browser.newContext(),merchant=await browser.newContext();let original=0,newReport=0,doctorId=0;
  try {
    const email=await register(doctor.request,"DOCTOR");await register(page.request,"USER");await register(merchant.request,"MERCHANT");
    original=await report(page.request);doctorId=(await call<{doctorId:number}>(page.request,`/reports/${original}/grants`,"POST",{doctorEmail:email})).doctorId;
    const id=(await call<{id:number}>(page.request,"/consultations","POST",{reportId:original,doctorId,question:"虚构随访测试"})).id;
    await call(doctor.request,`/doctor/consultations/${id}/claim`,"POST");
    expect((await merchant.request.get(`${base}/api/followups/${id}`)).status()).toBe(403);
    expect((await doctor.request.post(`${base}/api/followups/${id}/close`,{data:{summary:"无 CSRF",tasks:[]}})).status()).toBe(403);
    const dp=await doctor.newPage();await dp.goto(`/doctor/messages?conversation=${id}`);
    await dp.getByRole("link",{name:"结束咨询 / 整理随访"}).click();
    await dp.getByLabel("沟通小结",{exact:true}).fill("已整理用户提供的记录，后续由用户自行确认提醒。仅为测试记录。");
    await dp.getByLabel("待办建议（选填）").fill("补充下一份测量记录的条件");
    await dp.getByRole("button",{name:"结束咨询并保存小结"}).click();
    await expect(dp.getByRole("heading",{name:`咨询 #${id} · 已结束`})).toBeVisible();
    await page.goto(`/patient/messages?conversation=${id}`);
    await expect(page.getByLabel("输入消息")).toBeDisabled();await page.getByRole("link",{name:"查看小结与随访"}).click();
    await expect(page.locator(".followup-task")).toContainText("待你确认");
    await page.getByLabel("确认提醒时间").fill("2027-01-02T10:30");await page.getByRole("button",{name:"确认并启用提醒"}).click();
    await expect(page.locator(".followup-task")).toContainText("提醒已设置");
    await page.reload();await expect(page.locator(".followup-task")).toContainText("提醒已设置");
    newReport=await report(page.request);
    await page.getByLabel("关联新报告编号（选填）").fill(String(newReport));await page.getByRole("button",{name:"完成待办",exact:true}).click();
    await expect(page.locator(".followup-task")).toContainText("已完成");await dp.reload();
    await expect(dp.locator(".followup-task")).toContainText("尚未授权或已撤销授权");
    expect((await doctor.request.get(`${base}/api/reports/${newReport}`)).status()).toBe(404);
    await call(page.request,`/reports/${newReport}/grants`,"POST",{doctorEmail:email});await dp.reload();
    await dp.getByRole("button",{name:`查看关联报告 #${newReport}`}).click();await expect(dp.getByRole("region",{name:"关联报告内容"})).toBeVisible();
    await call(page.request,`/reports/${newReport}/grants/${doctorId}`,"DELETE");await dp.reload();
    await expect(dp.locator(".followup-task")).toContainText("尚未授权或已撤销授权");
    await page.getByLabel("提醒内容",{exact:true}).fill("自行整理记录");await page.getByLabel("提醒时间",{exact:true}).fill("2027-01-03T10:30");await page.getByRole("button",{name:"保存我的提醒"}).click();
    await expect(page.locator(".followup-task")).toHaveCount(2);await page.getByRole("button",{name:"保存我的提醒"}).click();await expect(page.locator(".followup-task")).toHaveCount(2);
    await page.getByRole("button",{name:"取消此提醒"}).click();await expect(page.locator(".followup-task").last()).toContainText("已取消");
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:info.outputPath("followup-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await call(page.request,`/reports/${original}/grants/${doctorId}`,"DELETE");await dp.reload();await expect(dp.getByRole("region",{name:"随访详情"}).getByRole("alert")).toContainText("授权已撤销");
  } finally {
    if(doctorId)for(const id of [original,newReport].filter(Boolean))await call(page.request,`/reports/${id}/grants/${doctorId}`,"DELETE");
    await doctor.close();await merchant.close();
  }
});

test("随访提醒真实调度：到期通知只生成一次且取消后隐藏",async({page,browser})=>{
  const doctor=await browser.newContext();let original=0,doctorId=0;
  try {
    const email=await register(doctor.request,"DOCTOR");await register(page.request,"USER");original=await report(page.request);
    doctorId=(await call<{doctorId:number}>(page.request,`/reports/${original}/grants`,"POST",{doctorEmail:email})).doctorId;
    const id=(await call<{id:number}>(page.request,"/consultations","POST",{reportId:original,doctorId})).id;
    await call(doctor.request,`/doctor/consultations/${id}/claim`,"POST");await call(doctor.request,`/followups/${id}/close`,"POST",{summary:"虚构调度测试",tasks:[]});
    const result=await call<{tasks:{id:number}[]}>(page.request,`/followups/${id}/tasks`,"POST",{title:"自行选择的测试提醒",dueAt:new Date(Date.now()+3500).toISOString(),clientKey:randomUUID()});const taskId=result.tasks[0].id;
    const notices=async()=> (await call<{items:{type:string;resourceId:number}[]}>(page.request,"/notifications")).items.filter(n=>n.type==="RECORD_REMINDER_DUE"&&n.resourceId===taskId);
    await expect.poll(async()=> (await notices()).length,{timeout:25000}).toBe(1);
    await page.goto("/patient/notifications");const notice=page.locator(".notification-item").filter({hasText:"你确认的记录提醒已到期"});await notice.getByRole("button",{name:"查看详情"}).click();
    await expect(page).toHaveURL(new RegExp(`/patient/followups\\?consultation=${id}$`));await expect(page.locator(".followup-task")).toContainText("提醒已到期");
    await page.getByRole("button",{name:"取消此提醒"}).click();await expect(page.locator(".followup-task")).toContainText("已取消");await expect.poll(async()=>(await notices()).length).toBe(0);
  } finally {if(original&&doctorId)await call(page.request,`/reports/${original}/grants/${doctorId}`,"DELETE");await doctor.close();}
});
