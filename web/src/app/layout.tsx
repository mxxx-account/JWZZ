import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "见微知著 | 体检指标解读",
  description: "体检指标解读与健康风险管理平台的研究原型",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
