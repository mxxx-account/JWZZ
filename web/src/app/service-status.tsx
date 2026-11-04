"use client";

import { useState } from "react";

export function ServiceStatus() {
  const [message, setMessage] = useState("尚未检查服务状态");
  async function check() {
    setMessage("正在检查…");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("服务未就绪");
      const result = await response.json();
      setMessage(result.status === "ok" ? "Java 服务已连接" : "服务返回异常状态");
    } catch {
      setMessage("Java 服务暂未连接，请查看本地开发说明");
    }
  }
  return <div className="status"><button onClick={check}>检查后端连接</button><span role="status">{message}</span></div>;
}
