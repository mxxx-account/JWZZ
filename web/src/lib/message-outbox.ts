// Tab-scoped recovery only; never share pending text between accounts or conversations.
export function outboxKey(userId: number, domain: string, conversationId: number) {
  return `jwzz-message:${userId}:${domain}:${conversationId}`;
}
export function pendingMessage(key: string): { body: string; clientMessageId: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return typeof value?.body === "string" && typeof value?.clientMessageId === "string" ? value : null;
  } catch { return null; }
}
export function prepareMessage(key: string, body: string) {
  const previous = pendingMessage(key);
  const message = previous?.body === body ? previous : { body, clientMessageId: crypto.randomUUID() };
  sessionStorage.setItem(key, JSON.stringify(message));
  return message;
}
