import { ServiceStatus } from "./service-status";
import { AuthPanel } from "./auth-panel";

export default function Home() {
  return (
    <main>
      <div className="shell">
        <span className="badge">第一版 · 指标录入研发预览</span>
        <h1>见微知著</h1>
        <p className="lead">体检指标解读与健康风险管理平台</p>
        <p>现已可以注册登录、录入血压/血糖/血脂指标，并体验报告访问授权。规则解读仍待临床审核，正式报告和趋势图将在后续阶段实现。</p>
        <ServiceStatus />
        <AuthPanel />
        <section className="cards">
          <article><h2>记录指标</h2><p>保存测量时间、单位和测量条件，让每条数据都有上下文。</p></article>
          <article><h2>理解结果</h2><p>展示规则依据及版本，并清楚说明哪些指标值得关注。</p></article>
          <article><h2>查看趋势</h2><p>对比同类指标的多次记录，帮助用户准备就医沟通。</p></article>
        </section>
        <p className="note">当前阶段的报告为虚构演示数据，仅用来验收角色和访问权限；指标录入不会自动生成报告。</p>
      </div>
    </main>
  );
}
