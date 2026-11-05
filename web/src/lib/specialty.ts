import type { Report, Specialty } from "./api";

export const specialtyLabels: Record<Specialty, string> = {
  GENERAL: "全科医学科",
  CARDIOLOGY: "心血管内科",
  ENDOCRINOLOGY: "内分泌科",
};

type Hint = { primary: Specialty; alternatives: Specialty[]; explanation: string };

function flagged(report: Report): boolean {
  const label = report.content.interpretations?.[0]?.label ?? "";
  if (report.content.category === "BP") return label !== "" && label !== "正常参考区间";
  if (report.content.category === "GLUCOSE") return label.startsWith("达到") || label.startsWith("处于");
  if (report.content.category === "LIPID") return label.includes("不低于常用参考界限");
  return false;
}

export function specialtyHint(report: Report, allReports: Report[]): Hint {
  const latestByCategory = new Map<string, Report>();
  for (const item of [...allReports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
    const category = item.content.category;
    if (category && !latestByCategory.has(category)) latestByCategory.set(category, item);
  }
  const flaggedCategories = new Set([...latestByCategory.values()].filter(flagged).map(item => item.content.category));
  if (flaggedCategories.size >= 3) return {
    primary: "GENERAL", alternatives: ["ENDOCRINOLOGY", "CARDIOLOGY"],
    explanation: "多类指标均有待复核的参考提示，可先由全科综合梳理；若主要担心血糖代谢或心血管问题，也可自行选择相应专科。",
  };
  if (flaggedCategories.has("GLUCOSE") && flaggedCategories.has("LIPID")) return {
    primary: "ENDOCRINOLOGY", alternatives: ["GENERAL", "CARDIOLOGY"],
    explanation: "血糖与血脂同时需要讨论时，可优先考虑内分泌科；具体仍需医生结合病史判断。",
  };
  if (flaggedCategories.has("BP") && flaggedCategories.has("LIPID")) return {
    primary: "CARDIOLOGY", alternatives: ["GENERAL", "ENDOCRINOLOGY"],
    explanation: "血压与血脂同时需要讨论时，可优先考虑心血管内科；也可以先由全科综合评估。",
  };
  switch (report.content.category) {
    case "BP": return { primary: "CARDIOLOGY", alternatives: ["GENERAL"], explanation: "这份报告以血压为主，可选择心血管内科讨论测量与复核。" };
    case "GLUCOSE": return { primary: "ENDOCRINOLOGY", alternatives: ["GENERAL"], explanation: "这份报告以血糖为主，可选择内分泌科讨论测量条件与复核。" };
    case "LIPID": return { primary: "ENDOCRINOLOGY", alternatives: ["CARDIOLOGY", "GENERAL"], explanation: "血脂问题可向内分泌科或心血管内科咨询；伴血糖关注可偏向内分泌，伴血压或心血管关注可偏向心内。" };
    default: return { primary: "GENERAL", alternatives: [], explanation: "不确定选哪个科室时，可先由全科协助梳理。" };
  }
}
