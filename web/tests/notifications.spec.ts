import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const base=process.env.TEST_API_URL ?? "http://localhost:8080";
type Notice={id:number;type:string;resourceId:number;readAt:string|null};
async function csrf(client:APIRequestContext) { return (await (await client.get(`${base}/api/auth/csrf`)).json()).token as string; }
async function call<T=void>(client:APIRequestContext,path:string,method="GET",data?:unknown):Promise<T> {
  const response=await client.fetch(`${base}/api${path}`,{method,data,headers:method==="GET"?undefined:{"X-XSRF-TOKEN":await csrf(client)}});
  expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);
  return response.status()===204 ? undefined as T : await response.json();
}
async function register(client:APIRequestContext,role:string) {
  const email=`notification-${role.toLowerCase()}-${randomUUID()}@example.invalid`,password="SyntheticNoticeTest123!";
  await call(client,"/auth/register","POST",{email,password,name:"通知测试",role,specialty:role==="DOCTOR"?"GENERAL":undefined});
  const response=await client.post(`${base}/api/auth/login`,{headers:{"X-XSRF-TOKEN":await csrf(client)},form:{email,password}});
  expect(response.ok()).toBe(true); return email;
}
async function notices(client:APIRequestContext) { return (await call<{items:Notice[]}>(client,"/notifications")).items; }

test("通知真实链路：咨询提交、回复、已读独立、越权与撤权",async({page,browser},info)=>{
  const doctor=await browser.newContext(), stranger=await browser.newContext();
  let reportId=0,doctorId=0;
  try {
    const email=await register(doctor.request,"DOCTOR"); await register(page.request,"USER"); await register(stranger.request,"MERCHANT");
    const entry=await call<{entryId:string}>(page.request,"/indicators","POST",{category:"BP",measuredAt:"2026-01-02T10:00:00",context:"HOME",ageYears:22,pregnant:false,values:{systolic_bp:{value:130,unit:"mmHg"},diastolic_bp:{value:80,unit:"mmHg"}}});
    reportId=(await call<{id:number}>(page.request,"/reports","POST",{entryId:entry.entryId})).id;
    doctorId=(await call<{doctorId:number}>(page.request,`/reports/${reportId}/grants`,"POST",{doctorEmail:email})).doctorId;
    const chat=await call<{id:number}>(page.request,"/consultations","POST",{reportId,doctorId,question:"不应出现在通知正文的虚构敏感内容"});
    await expect.poll(async()=> (await notices(doctor.request)).length).toBe(1);
    const doctorNotice=(await notices(doctor.request))[0];
    expect((await call<{unreadCount:number}>(doctor.request,"/notifications/unread-count")).unreadCount).toBe(1);
    expect((await notices(stranger.request)).length).toBe(0);
    expect((await stranger.request.post(`${base}/api/notifications/${doctorNotice.id}/read`,{headers:{"X-XSRF-TOKEN":await csrf(stranger.request)}})).status()).toBe(404);
    expect((await doctor.request.post(`${base}/api/notifications/${doctorNotice.id}/read`)).status()).toBe(403);
    const doctorPage=await doctor.newPage(); await doctorPage.goto("/doctor/notifications");
    await expect(doctorPage.getByRole("heading",{name:"收到新的咨询"})).toBeVisible();
    await expect(doctorPage.locator(".notification-list")).not.toContainText("虚构敏感内容");
    await doctorPage.getByRole("button",{name:"查看详情"}).click();
    await expect(doctorPage).toHaveURL(/\/doctor$/);
    await doctorPage.locator(`[data-consultation-id="${chat.id}"]`).getByRole("button",{name:"接受咨询并进入消息"}).click();
    await doctorPage.getByLabel("输入消息").fill("通知回归的虚构回复。"); await doctorPage.getByRole("button",{name:"发送",exact:true}).click();
    await expect.poll(async()=> (await notices(page.request)).length).toBe(1);
    await page.goto("/patient/notifications");
    await expect(page.getByRole("heading",{name:"医生回复了咨询"})).toBeVisible();
    await page.screenshot({path:info.outputPath("notification-center.png"),fullPage:true});
    await page.getByRole("button",{name:"标为已读"}).click();
    await expect(page.getByRole("link",{name:"通知中心，0 条未读"})).toBeVisible();
    const messages=await call<{items:{id:number;unreadCount:number}[]}>(page.request,"/messages/conversations/page");
    expect(messages.items.find(item=>item.id===chat.id)?.unreadCount).toBe(1);
    await page.getByRole("button",{name:"未读通知"}).click(); await expect(page.locator(".notification-item")).toHaveCount(0);
    await page.getByRole("button",{name:"全部通知"}).click(); await page.getByRole("button",{name:"查看详情"}).click();
    await expect(page).toHaveURL(new RegExp(`/patient/messages\\?conversation=${chat.id}$`));
    await expect(page.locator(".chat-thread")).toContainText("通知回归的虚构回复。");
    await call(page.request,`/reports/${reportId}/grants/${doctorId}`,"DELETE");
    expect(await notices(doctor.request)).toHaveLength(0);
    expect((await doctor.request.post(`${base}/api/notifications/${doctorNotice.id}/read`,{headers:{"X-XSRF-TOKEN":await csrf(doctor.request)}})).status()).toBe(404);
  } finally {
    if(reportId && doctorId) await call(page.request,`/reports/${reportId}/grants/${doctorId}`,"DELETE");
    await doctor.close(); await stranger.close();
  }
});

test("通知真实链路：商家重复接单只通知一次，详情直达对应订单",async({page,browser})=>{
  const merchant=await browser.newContext(); let storeCreated=false;
  try {
    await register(merchant.request,"MERCHANT"); await register(page.request,"USER");
    await call(merchant.request,"/merchant/store","POST",{name:"通知演示店",city:"测试城市",address:"虚构地址"}); storeCreated=true;
    const sku=(await call<{id:number}[]>(merchant.request,"/merchant/products"))[0].id;
    await call(merchant.request,`/merchant/products/${sku}/inventory`,"PUT",{available:2,note:"测试备货"});
    await call(merchant.request,`/merchant/products/${sku}/status`,"PUT",{status:"ON_SHELF"});
    await call(merchant.request,"/merchant/store/status","PUT",{status:"OPEN"});
    await call(page.request,"/shop/cart/items","POST",{skuId:sku,quantity:1});
    const order=(await call<{order:{id:number}}>(page.request,"/shop/orders","POST",{idempotencyKey:randomUUID()})).order.id;
    await call(page.request,`/shop/orders/${order}/pay`,"POST");
    await call(merchant.request,`/merchant/orders/${order}/accept`,"POST"); await call(merchant.request,`/merchant/orders/${order}/accept`,"POST");
    await expect.poll(async()=> (await notices(page.request)).length).toBe(1);
    await page.goto("/patient/notifications"); await expect(page.getByRole("heading",{name:"商家已接受订单"})).toBeVisible();
    await page.getByRole("button",{name:"查看详情"}).click();
    await expect(page).toHaveURL(new RegExp(`/patient/pharmacy\\?order=${order}$`));
    await expect(page.locator(".shop-order-detail")).toContainText(`订单 #${order}`);
    await expect(page.locator(".shop-order-detail")).toContainText("商家已接单");
    expect(await notices(merchant.request)).toHaveLength(0);
  } finally {
    if(storeCreated) await call(merchant.request,"/merchant/store/status","PUT",{status:"DRAFT"});
    await merchant.close();
  }
});

test("通知分页、未读筛选、断线重试和窄屏布局",async({page})=>{
  let offline=false;
  const rows=Array.from({length:41},(_,index)=>({id:41-index,type:"ORDER_EXPIRED",resourceId:100+index,title:"待支付订单已超时关闭",description:"演示订单已关闭，预留库存已释放。",href:"/patient/pharmacy?order=100",createdAt:"2026-01-02T10:00:00",readAt:index%2?"2026-01-02T11:00:00":null}));
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url());
    const headers={"Access-Control-Allow-Origin":new URL(page.url()).origin,"Access-Control-Allow-Credentials":"true"};
    if(offline) return route.abort("connectionreset");
    if(url.pathname==="/api/auth/me") return route.fulfill({headers,json:{id:1,role:"USER",email:"test@example.invalid",name:"测试用户"}});
    if(url.pathname.endsWith("/unread-count")) return route.fulfill({headers,json:{unreadCount:21}});
    const before=Number(url.searchParams.get("beforeId")??42);
    const list=rows.filter(item=>item.id<before && (url.searchParams.get("unreadOnly")!=="true" || !item.readAt));
    return route.fulfill({headers,json:{items:list.slice(0,20),hasMore:list.length>20}});
  });
  await page.goto("/patient/notifications"); await expect(page.locator(".notification-item")).toHaveCount(20);
  await page.getByRole("button",{name:"加载更多通知"}).click(); await expect(page.locator(".notification-item")).toHaveCount(40);
  await page.getByRole("button",{name:"加载更多通知"}).click(); await expect(page.locator(".notification-item")).toHaveCount(41);
  await page.getByRole("button",{name:"未读通知"}).click(); await expect(page.locator(".notification-item")).toHaveCount(20);
  await page.getByRole("button",{name:"加载更多通知"}).click(); await expect(page.locator(".notification-item")).toHaveCount(21);
  const alert=page.getByRole("region",{name:"通知中心"}).getByRole("alert");
  offline=true; await page.getByRole("button",{name:"刷新通知"}).click(); await expect(alert).toBeVisible();
  offline=false; await page.getByRole("button",{name:"刷新通知"}).click(); await expect(alert).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
