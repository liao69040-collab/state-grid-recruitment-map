/** Optional public contact text supplied by the deployer at build time. */
export const projectName = 'Hengzhen Grid Atlas';
export const projectContact = String(import.meta.env?.VITE_PROJECT_CONTACT ?? '').trim();
