// Configure your own approved filing number when deploying in a jurisdiction that requires it.
export const siteFiling: { icpNumber: string | null; icpUrl: string } = {
  icpNumber: import.meta.env.VITE_ICP_NUMBER || null,
  icpUrl: 'https://beian.miit.gov.cn/',
};
