export const navigationGroups = [
  { label: "一、用户与权限", keys: [], links: [{ label: "手机号授权", path: "/users", icon: "User" }] },
  { label: "二、全国资料与前台核对", keys: [], links: [
    { label: "招聘资料与条件", path: "/grid-query?tab=facts", icon: "Tickets" },
    { label: "全国院校与录用公示", path: "/grid-query?tab=rankings", icon: "School" },
    { label: "省市学校与单位名录", path: "/grid-query?tab=directory", icon: "OfficeBuilding" },
    { label: "地图目录与位置", path: "/grid-query?tab=map", icon: "MapLocation" },
    { label: "资料来源与版本", path: "/grid-query?tab=sources", icon: "Document" },
  ] },
  { label: "三、招聘业务维护", keys: ["recruitment-batches", "recruitment-requirements", "early-batch-policies", "recruitment-events", "recruitment-metrics"], links: [] },
  { label: "四、基础名录维护", keys: ["provinces", "cities", "schools", "companies"], links: [] },
  { label: "五、来源、发布与安全", keys: ["sources", "revisions", "audit-events"], links: [] },
];
