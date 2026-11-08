import { test, expect, type Page } from "@playwright/test";
const password = "ProductionSmoke123!";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function register(page: Page, role: string, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption(role);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill("生产包虚构测试");
  await page.getByLabel("密码").fill(password);
  if (role === "DOCTOR") await page.getByLabel("科室").selectOption("GENERAL");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(role === "MERCHANT" ? /\/merchant$/ : role === "DOCTOR" ? /\/doctor$/ : /\/patient$/);
}
test("生产包用户录入、报告、用品首页与搜索", async ({ page }) => {
  await register(page, "USER", `prod-user-${unique()}@example.invalid`);
  await page.getByLabel("指标分类").selectOption("BP");
  await page.locator(".value-field").filter({ hasText: "收缩压" }).locator("input").fill("125");
  await page.locator(".value-field").filter({ hasText: "舒张压" }).locator("input").fill("80");
  await page.getByRole("button", { name: "保存指标并查看研发预览" }).click();
  await expect(page.getByText("指标已保存。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /最近录入/ }).click();
  await page.getByRole("button", { name: "生成／查看这次的报告" }).first().click();
  await expect(page.locator(".archive-row")).toHaveCount(1);
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(6);
  await page.getByLabel("搜索商品或店铺").fill("不存在的生产测试用品");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("暂无符合条件的有货商品", { exact: false })).toBeVisible();
});
test("生产包医生注册并进入首页和咨询消息", async ({ page }) => {
  await register(page, "DOCTOR", `prod-doctor-${unique()}@example.invalid`);
  await page.getByRole("link", { name: "咨询消息" }).click();
  await expect(page.getByRole("heading", { name: "选择一个会话" })).toBeVisible();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor$/);
});
test("生产包特殊店名按文本展示，注入样式搜索不返回全部商品", async ({ page }) => {
  let dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  const name="<img src=x onerror=alert(1)> ' OR 1=1 --";
  await register(page,"MERCHANT",`prod-input-${unique()}@example.invalid`);
  await page.getByLabel("店铺名称").fill(name);
  await page.getByLabel("所在城市").fill("武汉");
  await page.getByLabel("店铺地址").fill("虚构测试");
  await page.getByRole("button",{name:"创建店铺"}).click();
  await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
  await expect(page.locator("img[onerror]")).toHaveCount(0);
  expect(dialogs).toBe(0);
  await page.getByRole("button",{name:"退出登录"}).click();
  await register(page,"USER",`prod-search-${unique()}@example.invalid`);
  await page.getByRole("link",{name:"药店"}).click();
  await page.getByLabel("搜索商品或店铺").fill("' OR 1=1 --");
  await page.getByRole("button",{name:"搜索",exact:true}).click();
  await expect(page.getByText("暂无符合条件的有货商品",{exact:false})).toBeVisible();
});
test("生产包商家备货、用户下单模拟支付和商家接单", async ({ page }) => {
  const suffix=unique(), merchant=`prod-merchant-${suffix}@example.invalid`, storeName=`生产包演示店-${suffix}`;
  await register(page,"MERCHANT",merchant);
  await page.getByLabel("店铺名称").fill(storeName);
  await page.getByLabel("所在城市").fill("武汉市");
  await page.getByLabel("店铺地址").fill("虚构地址");
  await page.getByRole("button",{name:"创建店铺"}).click();
  const product=page.locator(".merchant-product-item").filter({hasText:"电子血压计"});
  await product.getByRole("button",{name:"调整库存"}).click();
  await product.getByLabel("目标库存").fill("2");
  await product.getByRole("button",{name:"保存库存"}).click();
  await expect(product).toContainText("可售库存：2");
  await product.getByRole("button",{name:"上架",exact:true}).click();
  await expect(product).toContainText("已上架");
  await page.getByRole("button",{name:"开始演示营业"}).click();
  await expect(page.getByText("演示营业中",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"退出登录"}).click();
  await register(page,"USER",`prod-buyer-${suffix}@example.invalid`);
  await page.getByRole("link",{name:"药店"}).click();
  await page.getByLabel("搜索商品或店铺").fill(storeName);
  await page.getByRole("button",{name:"搜索",exact:true}).click();
  await page.locator(".shop-store").filter({hasText:storeName}).getByRole("button",{name:"加入购物车"}).click();
  await page.getByRole("button",{name:"购物车（1）"}).click();
  await page.getByRole("button",{name:"提交演示订单"}).click();
  await expect(page.locator(".shop-order-detail")).toContainText("待模拟支付");
  await page.getByRole("button",{name:"模拟支付",exact:true}).click();
  await expect(page.locator(".shop-order-detail")).toContainText("已模拟支付");
  await page.getByRole("button",{name:"退出登录"}).click();
  await page.getByLabel("身份").selectOption("MERCHANT");
  await page.getByLabel("邮箱").fill(merchant);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button",{name:"登录",exact:true}).last().click();
  await expect(page).toHaveURL(/\/merchant$/);
  await page.getByRole("button",{name:"接受演示订单"}).click();
  try {
    await expect(page.locator(".merchant-order-list")).toContainText("已接单");
    const actual = await page.evaluate(async () => {
      const response=await fetch("http://localhost:8083/api/merchant/products",{credentials:"include"});
      return (await response.json() as {name:string;reserved:number}[]).find(item=>item.name==="电子血压计")!;
    });
    expect(actual.reserved).toBe(0);
    await expect(product).toContainText("已预留：0");
  } finally {
    await page.getByRole("button",{name:"暂停演示营业"}).click();
  }
});
