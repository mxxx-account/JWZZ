import { ServiceStatus } from "./service-status";

export default function Home() {
  return (
    <main>
      <div className="shell">
        <span className="badge">第一版 · 工程骨架</span>
        <h1>见微知著</h1>
        <p className="lead">体检指标解读与健康风险管理平台</p>
        <p>我们正在构建血压、血糖、血脂的录入、规则化解读、历史趋势和授权查看流程。</p>
        <ServiceStatus />
        <section className="cards">
          <article><h2>记录指标</h2><p>保存测量时间、单位和测量条件，让每条数据都有上下文。</p></article>
          <article><h2>理解结果</h2><p>展示规则依据及版本，并清楚说明哪些指标值得关注。</p></article>
          <article><h2>查看趋势</h2><p>对比同类指标的多次记录，帮助用户准备就医沟通。</p></article>
        </section>
        <p className="note">当前页面用于验证工程连接。具体指标判断规则与登录功能将在后续阶段实现。</p>
      </div>
    </main>
  );
}
