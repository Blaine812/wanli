// The review build is deliberately isolated from the live website and database.
export const localPreview=import.meta.env.DEV||import.meta.env.VITE_LOCAL_PREVIEW==='true';

// Approved community features are available on the published website.
export const communityEnabled=true;
