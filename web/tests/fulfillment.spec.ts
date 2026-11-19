import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const base=process.env.TEST_API_URL??"http://localhost:8080";
async function token(c:APIRequestContext){return(await(await c.get(`${base}/api/auth/csrf`)).json()).token;}
async function call<T=void>(c:APIRequestContext,path:string,method="GET",data?:unknown):Promise<T>{const r=await c.fetch(`${base}/api${path}`,{method,data,headers:method==="GET"?undefined:{"X-XSRF-TOKEN":await token(c)}});expect(r.ok(),`${path}: ${r.status()} ${await r.text()}`).toBe(true);return r.status()===204?undefined as T:await r.json();}
async function account(c:APIRequestContext,role:string){const email=`fulfillment-${randomUUID()}@example.invalid`,password="SyntheticFulfillment123!";await call(c,"/auth/register","POST",{email,password,role,name:"履约测试",specialty:role==="DOCTOR"?"GENERAL":undefined});expect((await c.post(`${base}/api/auth/login`,{form:{email,password},headers:{"X-XSRF-TOKEN":await token(c)}})).ok()).toBe(true);}
type Life={order:{status:string;totalCents:number};refunds:{id:number;status:string;disposition:string}[];ledger:{amountCents:number}[]};
async function fixture(page:Page,browser:Browser){const merchant=await browser.newContext();await account(merchant.request,"MERCHANT");await account(page.request,"USER");await call(merchant.request,"/merchant/store","POST",{name:"模拟履约店",city:"演示市",address:"虚构地址"});const sku=(await call<{id:number}[]>(merchant.request,"/merchant/products"))[0].id;await call(merchant.request,`/merchant/products/${sku}/inventory`,"PUT",{available:5,note:"模拟备货"});await call(merchant.request,`/merchant/products/${sku}/status`,"PUT",{status:"ON_SHELF"});await call(merchant.request,"/merchant/store/status","PUT",{status:"OPEN"});const mp=await merchant.newPage();return {merchant,mp,sku};}
async function order(page:Page,sku:number){await call(page.request,"/shop/cart/items","POST",{skuId:sku,quantity:1});const id=(await call<{order:{id:number}}>(page.request,"/shop/orders","POST",{idempotencyKey:randomUUID()})).order.id;await call(page.request,`/shop/orders/${id}/pay`,"POST");return id;}
async function merchantOrder(page:Page,id:number){await page.goto("/merchant");await page.locator(".merchant-order-list article").filter({hasText:`订单 #${id} ·`}).getByRole("button",{name:"查看明细"}).click();}

test("履约闭环：发货收货、拒绝后再申请、退货验收入库与退款流水",async({page,browser},info)=>{
  test.setTimeout(100000);const f=await fixture(page,browser);
  try {
    const id=await order(page,f.sku);await call(f.merchant.request,`/merchant/orders/${id}/accept`,"POST");await merchantOrder(f.mp,id);
    const seller=f.mp.getByRole("region",{name:"模拟履约与退款"});await seller.getByRole("button",{name:"模拟发货",exact:true}).click();await expect(seller).toContainText("已模拟发货");
    await page.goto(`/patient/pharmacy?order=${id}`);const buyer=page.getByRole("region",{name:"模拟履约与退款"});await buyer.getByRole("button",{name:"确认模拟收货"}).click();await expect(buyer).toContainText("订单完成");
    await buyer.getByLabel("退款原因").fill("第一份虚构退款原因");await buyer.getByRole("button",{name:"申请整单模拟退款"}).click();await expect(buyer).toContainText("待商家审核");
    await seller.getByRole("button",{name:"刷新履约状态"}).click();await seller.getByLabel("审核说明").fill("请补充演示原因");await seller.getByRole("button",{name:"拒绝退款申请"}).click();
    await buyer.getByRole("button",{name:"刷新履约状态"}).click();await buyer.getByLabel("退款原因").fill("补充后的演示原因");await buyer.getByRole("button",{name:"申请整单模拟退款"}).click();
    await seller.getByRole("button",{name:"刷新履约状态"}).click();await seller.getByLabel("审核说明").fill("同意演示退货");await seller.getByRole("button",{name:"同意退款申请"}).click();await expect(seller).toContainText("待用户模拟退货");
    expect((await call<Life>(page.request,`/shop/orders/${id}/lifecycle`)).ledger).toHaveLength(0);
    await buyer.getByRole("button",{name:"刷新履约状态"}).click();await buyer.getByRole("button",{name:"提交模拟退货"}).click();await expect(buyer).toContainText("待商家验收");
    await seller.getByRole("button",{name:"刷新履约状态"}).click();await seller.getByLabel("退货验收库存处理").selectOption("RESTOCK");await seller.getByRole("button",{name:"确认验收并模拟退款"}).click();await expect(seller).toContainText("模拟退款成功");
    const inventory=await call<{id:number;available:number}[]>(f.merchant.request,"/merchant/products");expect(inventory.find(s=>s.id===f.sku)?.available).toBe(5);
    const life=await call<Life>(page.request,`/shop/orders/${id}/lifecycle`);expect(life.ledger).toHaveLength(1);expect(life.ledger[0].amountCents).toBe(life.order.totalCents);
    await buyer.getByRole("button",{name:"刷新履约状态"}).click();await expect(buyer).toContainText("已模拟退款");await buyer.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("refund-completed.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{await call(f.merchant.request,"/merchant/store/status","PUT",{status:"DRAFT"});await f.merchant.close();}
});

test("未接单退款：权限、校验、重复提交审核及原价全额退款",async({page,browser})=>{
  const f=await fixture(page,browser),other=await browser.newContext(),doctor=await browser.newContext();
  try {
    await account(other.request,"USER");await account(doctor.request,"DOCTOR");const id=await order(page,f.sku);
    expect((await other.request.get(`${base}/api/shop/orders/${id}/lifecycle`)).status()).toBe(404);
    expect((await doctor.request.get(`${base}/api/shop/orders/${id}/lifecycle`)).status()).toBe(403);
    expect((await page.request.post(`${base}/api/shop/orders/${id}/refunds`,{data:{reason:"no csrf",clientKey:randomUUID()}})).status()).toBe(403);
    expect((await page.request.post(`${base}/api/shop/orders/${id}/refunds`,{headers:{"X-XSRF-TOKEN":await token(page.request)},data:{reason:"",clientKey:"bad"}})).status()).toBe(400);
    const req={reason:"模拟未接单退款",clientKey:randomUUID(),amountCents:1};await call(page.request,`/shop/orders/${id}/refunds`,"POST",req);await call(page.request,`/shop/orders/${id}/refunds`,"POST",req);
    const refund=(await call<Life>(page.request,`/shop/orders/${id}/lifecycle`)).refunds[0].id;
    await merchantOrder(f.mp,id);const seller=f.mp.getByRole("region",{name:"模拟履约与退款"});await seller.getByLabel("审核说明").fill("确认演示退款");await seller.getByRole("button",{name:"同意退款申请"}).click();await expect(seller).toContainText("释放预留库存");
    await call(f.merchant.request,`/merchant/orders/${id}/refunds/${refund}/review`,"POST",{approve:true,note:"确认演示退款"});
    const life=await call<Life>(page.request,`/shop/orders/${id}/lifecycle`);expect(life.refunds).toHaveLength(1);expect(life.ledger).toHaveLength(1);expect(life.ledger[0].amountCents).toBe(life.order.totalCents);
    const stock=(await call<{id:number;available:number;reserved:number}[]>(f.merchant.request,"/merchant/products")).find(s=>s.id===f.sku)!;expect(stock.available).toBe(5);expect(stock.reserved).toBe(0);
  }finally{await call(f.merchant.request,"/merchant/store/status","PUT",{status:"DRAFT"});await f.merchant.close();await other.close();await doctor.close();}
});

test("退货报损：验收默认不入库、刷新恢复与网络失败重试",async({page,browser})=>{
  const f=await fixture(page,browser);
  try {
    const id=await order(page,f.sku);await call(f.merchant.request,`/merchant/orders/${id}/accept`,"POST");await call(f.merchant.request,`/merchant/orders/${id}/ship`,"POST",{code:`DEMO-SHIP-${id}`});
    const r=(await call<Life>(page.request,`/shop/orders/${id}/refunds`,"POST",{reason:"模拟报损退款",clientKey:randomUUID()})).refunds[0].id;
    await call(f.merchant.request,`/merchant/orders/${id}/refunds/${r}/review`,"POST",{approve:true,note:"同意退货"});await call(page.request,`/shop/orders/${id}/refunds/${r}/return`,"POST",{code:`DEMO-RETURN-${r}`});
    await merchantOrder(f.mp,id);const panel=f.mp.getByRole("region",{name:"模拟履约与退款"});await expect(panel.getByLabel("退货验收库存处理")).toHaveValue("DISCARD");
    await f.mp.route("**/lifecycle",route=>route.abort("connectionreset"));await panel.getByRole("button",{name:"刷新履约状态"}).click();await expect(panel.getByRole("alert")).toBeVisible();
    await f.mp.unroute("**/lifecycle");await panel.getByRole("button",{name:"刷新履约状态"}).click();await panel.getByRole("button",{name:"确认验收并模拟退款"}).click();await expect(panel).toContainText("报损，不回补库存");
    await merchantOrder(f.mp,id);await expect(panel).toContainText("模拟退款成功");expect((await call<{id:number;available:number}[]>(f.merchant.request,"/merchant/products")).find(s=>s.id===f.sku)?.available).toBe(4);
  }finally{await call(f.merchant.request,"/merchant/store/status","PUT",{status:"DRAFT"});await f.merchant.close();}
});
