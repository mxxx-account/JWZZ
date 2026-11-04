import type { Report } from "@/lib/api";

const labels: Record<string, string> = {
  systolic_bp: "收缩压", diastolic_bp: "舒张压", blood_glucose: "血糖", hba1c: "糖化血红蛋白",
  total_cholesterol: "总胆固醇", ldl_cholesterol: "LDL 胆固醇", hdl_cholesterol: "HDL 胆固醇", triglycerides: "甘油三酯",
};
const contextLabels: Record<string, string> = {
  HOME: "居家测量", CLINIC: "诊室测量", FASTING_PLASMA: "空腹实验室血浆",
  RANDOM: "随机实验室血糖", POST_MEAL: "餐后血糖", CAPILLARY: "指尖血糖",
  FASTING: "空腹实验室血脂", NON_FASTING: "非空腹实验室血脂",
};

export function ReportContent({ report }: { report: Report }) {
  const content = report.content;
  return <div className="report-content">
    <p>{content.message}</p>
    {content.sourceEntryId && <>
      <p className="note">测量条件：{contextLabels[content.context ?? ""] ?? content.context} · 测量时间：{content.measuredAt ? new Date(content.measuredAt).toLocaleString("zh-CN") : "未知"}</p>
      <ul>{content.values?.map(value => <li key={value.code}>{labels[value.code] ?? value.code}：{value.rawValue} {value.rawUnit} → {value.value} {value.unit}</li>)}</ul>
      <p className="note">规则版本：{report.ruleVersion} · 审核状态：待临床审核</p>
      {content.interpretations?.map(item => <div className="rule-result" key={item.ruleCode}>
        <strong>{item.label}</strong><p>{item.explanation}</p>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">规则来源：{item.sourceTitle}</a>
      </div>)}
      {!content.interpretations?.length && <p className="note">这份报告没有适用的已审核规则。没有规则不表示数值安全。</p>}
    </>}
  </div>;
}
