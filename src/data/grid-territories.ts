export type GridOperatorCode = "sgcc" | "csg" | "mixed" | "not_applicable";
export type GridEntryStatus = "enabled" | "disabled" | "mixed" | "not_applicable";

export interface GridTerritorySource {
  id: string;
  title: string;
  officialUrl: string;
  note: string;
}

export interface GridTerritory {
  adcode: string;
  name: string;
  shortName: string;
  operator: GridOperatorCode;
  operatorLabel: string;
  entryStatus: GridEntryStatus;
  canEnterStateGridMap: boolean;
  qualificationLabel: string;
  scopeNote: string;
  sourceIds: string[];
}

export interface ProvinceInsight {
  operatorLabel: string;
  scopeNote: string;
  entryEnabled: boolean;
  eligibilityLabel: string;
  eligibilityTone?: string;
  plannedHeadcount: string;
  applicationCount: string;
  examAttendance: string;
  admissionCount: string;
  sourceYear: string;
  sourceStatus: string;
}

export type ProvinceInsights = Readonly<Record<string, ProvinceInsight>>;

export const GRID_TERRITORY_SOURCES: Readonly<Record<string, GridTerritorySource>> = Object.freeze({
  "sgcc-recruitment-platform": {
    id: "sgcc-recruitment-platform",
    title: "国家电网有限公司人力资源招聘平台",
    officialUrl: "https://zhaopin.sgcc.com.cn/",
    note: "国家电网招聘公告、单位和应聘信息的官方入口。",
  },
  "sgcc-recruiting-units": {
    id: "sgcc-recruiting-units",
    title: "国家电网招聘平台单位列表",
    officialUrl: "https://zhaopin.sgcc.com.cn/sgcchr/static/unitPart.html",
    note: "用于核对国家电网招聘单位及省级招聘入口。",
  },
  "sgcc-operating-area": {
    id: "sgcc-operating-area",
    title: "国务院国资委：国家电网经营区域",
    officialUrl: "https://www.sasac.gov.cn/n4470048/n29955503/n32265122/n32265127/c29773055/content.html",
    note: "官方口径说明国家电网经营区域覆盖我国 26 个省（自治区、直辖市）。",
  },
  "csg-company-profile": {
    id: "csg-company-profile",
    title: "中国南方电网公司概况",
    officialUrl: "https://cxwt.sc.csg.cn/about.jhtml",
    note: "官方说明南方电网服务广东、广西、云南、贵州、海南五省区。",
  },
  "csg-recruitment-platform": {
    id: "csg-recruitment-platform",
    title: "中国南方电网招聘平台",
    officialUrl: "https://zhaopin.csg.cn/",
    note: "南方电网所属单位招聘的官方入口。",
  },
  "impc-company-profile": {
    id: "impc-company-profile",
    title: "内蒙古电力（集团）有限责任公司概况",
    officialUrl: "https://www.impc.com.cn/node_30256.html",
    note: "官方说明内蒙古电力负责自治区中西部电网（蒙西）。",
  },
  "inner-mongolia-mengdong-area": {
    id: "inner-mongolia-mengdong-area",
    title: "内蒙古自治区政府：蒙东四盟市地域口径",
    officialUrl: "https://www.xlgl.gov.cn/eportal/ui?articleKey=fc2e63a3b2244b0aaed526ed1697d117&columnId=7f1816de2cdf44a282e73a722d711be2&pageId=21029a71a03145928420ad6005010915",
    note: "用于核对蒙东四盟市地域范围；内蒙古必须按蒙东与蒙西分区呈现。",
  },
});

const STATE_GRID_SOURCE_IDS = ["sgcc-recruitment-platform", "sgcc-recruiting-units", "sgcc-operating-area"];
const SOUTHERN_GRID_SOURCE_IDS = ["csg-company-profile", "csg-recruitment-platform"];

const stateGridTerritory = (adcode: string, name: string, shortName: string): GridTerritory => ({
  adcode,
  name,
  shortName,
  operator: "sgcc",
  operatorLabel: "国家电网",
  entryStatus: "enabled",
  canEnterStateGridMap: true,
  qualificationLabel: "可进入国家电网省级地图",
  scopeNote: "属于国家电网省级招聘范围；招聘人数与资格仍以当年官方公告为准。",
  sourceIds: [...STATE_GRID_SOURCE_IDS],
});

const southernGridTerritory = (adcode: string, name: string, shortName: string): GridTerritory => ({
  adcode,
  name,
  shortName,
  operator: "csg",
  operatorLabel: "中国南方电网",
  entryStatus: "disabled",
  canEnterStateGridMap: false,
  qualificationLabel: "不属于国家电网省级招聘入口",
  scopeNote: "属于南方电网服务的五省区；本系统不使用国家电网口径展示。",
  sourceIds: [...SOUTHERN_GRID_SOURCE_IDS],
});

const notApplicableTerritory = (adcode: string, name: string, shortName: string, scopeNote: string): GridTerritory => ({
  adcode,
  name,
  shortName,
  operator: "not_applicable",
  operatorLabel: "非本系统内地省级招聘范围",
  entryStatus: "not_applicable",
  canEnterStateGridMap: false,
  qualificationLabel: "国家电网省级地图不适用",
  scopeNote,
  sourceIds: ["sgcc-recruiting-units", "csg-company-profile"],
});

export const GRID_TERRITORIES: readonly GridTerritory[] = Object.freeze([
  stateGridTerritory("110000", "北京市", "北京"),
  stateGridTerritory("120000", "天津市", "天津"),
  stateGridTerritory("130000", "河北省", "河北"),
  stateGridTerritory("140000", "山西省", "山西"),
  {
    adcode: "150000",
    name: "内蒙古自治区",
    shortName: "内蒙古",
    operator: "mixed",
    operatorLabel: "国家电网（蒙东） / 内蒙古电力（蒙西）",
    entryStatus: "mixed",
    canEnterStateGridMap: true,
    qualificationLabel: "仅国网蒙东资料可查看",
    scopeNote: "当前入口只展示国网蒙东招聘资料；不代表全内蒙古，不包含蒙西电网。省级底图仅用于入口定位，不表示经营范围覆盖全区。",
    sourceIds: [...STATE_GRID_SOURCE_IDS, "impc-company-profile", "inner-mongolia-mengdong-area"],
  },
  stateGridTerritory("210000", "辽宁省", "辽宁"),
  stateGridTerritory("220000", "吉林省", "吉林"),
  stateGridTerritory("230000", "黑龙江省", "黑龙江"),
  stateGridTerritory("310000", "上海市", "上海"),
  stateGridTerritory("320000", "江苏省", "江苏"),
  stateGridTerritory("330000", "浙江省", "浙江"),
  stateGridTerritory("340000", "安徽省", "安徽"),
  stateGridTerritory("350000", "福建省", "福建"),
  stateGridTerritory("360000", "江西省", "江西"),
  stateGridTerritory("370000", "山东省", "山东"),
  stateGridTerritory("410000", "河南省", "河南"),
  stateGridTerritory("420000", "湖北省", "湖北"),
  stateGridTerritory("430000", "湖南省", "湖南"),
  southernGridTerritory("440000", "广东省", "广东"),
  southernGridTerritory("450000", "广西壮族自治区", "广西"),
  southernGridTerritory("460000", "海南省", "海南"),
  stateGridTerritory("500000", "重庆市", "重庆"),
  stateGridTerritory("510000", "四川省", "四川"),
  southernGridTerritory("520000", "贵州省", "贵州"),
  southernGridTerritory("530000", "云南省", "云南"),
  stateGridTerritory("540000", "西藏自治区", "西藏"),
  stateGridTerritory("610000", "陕西省", "陕西"),
  stateGridTerritory("620000", "甘肃省", "甘肃"),
  stateGridTerritory("630000", "青海省", "青海"),
  stateGridTerritory("640000", "宁夏回族自治区", "宁夏"),
  stateGridTerritory("650000", "新疆维吾尔自治区", "新疆"),
  notApplicableTerritory("710000", "台湾省", "台湾", "不属于国家电网或南方电网内地省级招聘单位范围。"),
  notApplicableTerritory("810000", "香港特别行政区", "香港", "南方电网官方介绍提及为港澳地区提供电力服务保障，但不属于本系统内地省级招聘入口。"),
  notApplicableTerritory("820000", "澳门特别行政区", "澳门", "南方电网官方介绍提及为港澳地区提供电力服务保障，但不属于本系统内地省级招聘入口。"),
]);

export const GRID_TERRITORY_BY_ADCODE: ReadonlyMap<string, GridTerritory> = new Map(
  GRID_TERRITORIES.map((territory) => [territory.adcode, territory]),
);

const GRID_TERRITORY_BY_NAME: ReadonlyMap<string, GridTerritory> = new Map(
  GRID_TERRITORIES.flatMap((territory) => [
    [territory.name, territory] as const,
    [territory.shortName, territory] as const,
  ]),
);

export const getGridTerritory = (nameOrAdcode: string | number | null | undefined): GridTerritory | null => {
  const key = String(nameOrAdcode ?? "").trim();
  if (!key) return null;
  return GRID_TERRITORY_BY_ADCODE.get(key) ?? GRID_TERRITORY_BY_NAME.get(key) ?? null;
};

export const getGridTerritorySources = (territory: GridTerritory): GridTerritorySource[] => territory.sourceIds
  .map((sourceId) => GRID_TERRITORY_SOURCES[sourceId])
  .filter((source): source is GridTerritorySource => Boolean(source));
