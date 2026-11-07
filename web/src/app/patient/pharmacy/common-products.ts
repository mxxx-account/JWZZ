export type CommonProduct = {
  name: string;
  category: "健康器械" | "日常用品" | "营养补充";
  icon: string;
  description: string;
  keywords: string;
};

export const commonProducts: CommonProduct[] = [
  { name: "电子血压计", category: "健康器械", icon: "▥", description: "了解不同测量方式与袖带规格", keywords: "血压 血压仪 测量" },
  { name: "血糖仪", category: "健康器械", icon: "◈", description: "了解试纸兼容性与使用步骤", keywords: "血糖 测糖 仪器" },
  { name: "电子体温计", category: "健康器械", icon: "◉", description: "比较接触式测量用品", keywords: "体温 发烧 测温" },
  { name: "医用口罩", category: "日常用品", icon: "▤", description: "了解包装标识与佩戴方式", keywords: "口罩 防护" },
  { name: "维生素 C", category: "营养补充", icon: "✦", description: "仅展示品类，使用前核对成分", keywords: "维c vitamin c 保健品" },
  { name: "鱼油", category: "营养补充", icon: "◌", description: "仅展示品类，不代表适合个人", keywords: "omega 3 欧米伽 保健品" },
];
