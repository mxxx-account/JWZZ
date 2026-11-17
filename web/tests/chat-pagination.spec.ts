import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, shop: boolean, holdFirst = false) {
  const base = shop ? "/api/shop/conversations" : "/api/messages/conversations";
  const messages = Array.from({ length: 620 }, (_, i) => ({
    id: i + 1, senderId: 2, body: `历史-${i+1}`, createdAt: "2026-01-02T09:00:00",
  }));
  const reads: number[] = [], cursors: number[] = [];
  let offline = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const peer = (id: number) => ({ id, reportId: id, orderId: id, peerId: 2, peerName: `联系人${id}`,
    peerSpecialty: "GENERAL", peerOnline: false, status: "CLAIMED", orderStatus: "PAID", canSend: true,
    lastMessage: "测试", updatedAt: "2026-01-02T09:00:00", unreadCount: id === 1 ? messages.filter(m=>m.id>Math.max(0,...reads)).length : 0 });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const respond = (json: unknown, status = 200) => route.fulfill({ status,
      headers: { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true" }, json }).catch(()=>undefined);
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: {
      "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type,X-XSRF-TOKEN", "Access-Control-Allow-Methods": "GET,POST",
    } });
    if (path === "/api/auth/me") return respond({ id:1,email:"fixture@example.invalid",role:"USER",name:"测试用户" });
    if (path === "/api/auth/csrf") return respond({ token:"fixture" });
    if (offline) return route.abort("connectionreset");
    if(path === base + "/page") {
      const before=Number(url.searchParams.get("beforeId") ?? 126), size=Number(url.searchParams.get("size"));
      const rows=Array.from({length:125},(_,i)=>125-i).filter(id=>id<before);
      return respond({items:rows.slice(0,size).map(peer),hasMore:rows.length>size});
    }
    if(path.endsWith("/read")) {
      if(path === base + "/1/read") reads.push(route.request().postDataJSON().lastReadMessageId);
      return route.fulfill({status:204,headers:{"Access-Control-Allow-Origin":new URL(page.url()).origin,"Access-Control-Allow-Credentials":"true"}});
    }
    const id=Number(path.slice(base.length+1));
    if(Number.isFinite(id) && path.startsWith(base+"/")) {
      if(holdFirst && id===1) await gate;
      const before=Number(url.searchParams.get("beforeId") ?? Number.MAX_SAFE_INTEGER);
      const after=url.searchParams.get("afterId");
      if(after!==null) cursors.push(Number(after));
      const rows=id===1 ? messages.filter(m=>m.id<before && (after===null || m.id>Number(after))) : [{id:9000+id,senderId:2,body:"另一会话",createdAt:"2026-01-02T09:00:00"}];
      const size=Number(url.searchParams.get("size") ?? 50);
      return respond({conversation:peer(id),messages:after===null ? rows.slice(-size) : rows.slice(0,size),hasMore:rows.length>size});
    }
    return respond({});
  });
  return {messages, reads, cursors, release, setOffline:(value:boolean)=>{offline=value;}};
}

for(const shop of [false,true]) {
  test(`${shop?"商家":"咨询"}：最新页、历史锚点、分页会话、断线增量与可见已读`, async({page})=>{
    const f=await fixture(page,shop);
    await page.goto(`/patient/${shop?"shop-messages":"messages"}?conversation=1`);
    await expect(page.locator(".chat-row")).toHaveCount(50);
    await expect(page.locator(".chat-row").last()).toContainText("历史-620");
    await expect.poll(()=>Math.max(0,...f.reads)).toBe(620);
    await expect(page.locator(".chat-conversation")).toHaveCount(20);
    await page.getByRole("button",{name:"加载更多会话"}).click();
    await expect(page.locator(".chat-conversation")).toHaveCount(40);
    await page.locator(".chat-thread").evaluate(element=>{element.scrollTop=0;});
    await expect(page.locator(".chat-row")).toHaveCount(100);
    const top=await page.locator(".chat-thread").evaluate(element=>element.scrollTop);
    expect(top).toBeGreaterThan(0);
    f.setOffline(true);
    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status")).toContainText("连接暂不可用");
    for(let id=621;id<=745;id++) f.messages.push({id,senderId:2,body:`新增-${id}`,createdAt:"2026-01-02T09:00:00"});
    f.setOffline(false);
    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await expect(page.locator(".chat-row")).toHaveCount(225);
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(f.cursors).toEqual(expect.arrayContaining([620,670,720]));
    expect(Math.max(...f.reads)).toBe(620); // Incoming messages below viewport have not been read.
    await page.getByRole("button",{name:"回到最新消息"}).click();
    await expect.poll(()=>Math.max(...f.reads)).toBe(745);
    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await expect(page.locator(".chat-row")).toHaveCount(225);
    expect(new Set(await page.locator(".chat-row").evaluateAll(rows=>rows.map(row=>row.getAttribute("data-message-id")))).size).toBe(225);
  });

  test(`${shop?"商家":"咨询"}：切换会话丢弃迟到响应，不标记旧会话已读`,async({page})=>{
    const f=await fixture(page,shop,true);
    await page.goto(`/patient/${shop?"shop-messages":"messages"}?conversation=1`);
    await page.locator(".chat-conversation").filter({hasText:"联系人124"}).click();
    await expect(page.locator(".chat-peer-head")).toContainText("联系人124");
    f.release();
    await expect(page.locator(".chat-row")).toHaveCount(1);
    await expect(page.locator(".chat-peer-head")).toContainText("联系人124");
    expect(f.reads).toEqual([]);
  });
}
