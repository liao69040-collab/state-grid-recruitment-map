import type { InformationTab } from './information-display';

/** Phone reading destinations; no second navigation level or eligibility inference. */
export const mobileInformationModes = [
  { key: 'city', label: '本科进市局', tab: 'regions' },
  { key: 'early', label: '提前批', tab: 'regions' },
  { key: 'education', label: '学历要求', tab: 'batches' },
  { key: 'salary-score', label: '待遇分数', tab: 'regions' },
  { key: 'schools', label: '院校排名', tab: 'schools' },
] as const;
export type MobileInformationMode = typeof mobileInformationModes[number]['key'];
export type DirectRegionMode = Extract<MobileInformationMode, 'city' | 'early' | 'salary-score'>;
export const isMobileInformationMode = (value: unknown): value is MobileInformationMode =>
  mobileInformationModes.some(item => item.key === value);
export const mobileInformationTab = (mode: MobileInformationMode): InformationTab =>
  mobileInformationModes.find(item => item.key === mode)!.tab;
