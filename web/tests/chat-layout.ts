import { expect, type Page } from "@playwright/test";

export async function expectChatPanelsScrollable(page: Page) {
  const layout = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".chat-frame")!;
    const thread = document.querySelector<HTMLElement>(".chat-thread")!;
    const list = document.querySelector<HTMLElement>(".chat-conversation-list")!;
    const compose = document.querySelector<HTMLElement>(".chat-compose")!;
    for (let index = 0; index < 20; index++) {
      const message = document.createElement("div");
      message.style.minHeight = "80px";
      message.textContent = `布局测试消息 ${index}`;
      thread.append(message);
      const conversation = document.createElement("div");
      conversation.style.minHeight = "100px";
      conversation.textContent = `布局测试会话 ${index}`;
      list.append(conversation);
    }
    thread.scrollTop = thread.scrollHeight;
    list.scrollTop = list.scrollHeight;
    return {
      frameBottom: frame.getBoundingClientRect().bottom,
      composeBottom: compose.getBoundingClientRect().bottom,
      composeTop: compose.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
      pageScroll: window.scrollY,
      threadScroll: thread.scrollTop,
      listScroll: list.scrollTop,
      threadOverflow: getComputedStyle(thread).overflowY,
      listOverflow: getComputedStyle(list).overflowY,
    };
  });
  expect(layout.threadScroll).toBeGreaterThan(0);
  expect(layout.listScroll).toBeGreaterThan(0);
  expect(layout.threadOverflow).toBe("auto");
  expect(layout.listOverflow).toBe("auto");
  expect(layout.composeTop).toBeGreaterThan(0);
  expect(layout.composeBottom).toBeLessThanOrEqual(layout.frameBottom + 1);
  expect(layout.composeBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.pageScroll).toBe(0);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
}
