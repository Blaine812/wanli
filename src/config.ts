// Publishable keys are deliberately public. Database and Storage permissions are enforced server-side.
export const supabaseUrl=import.meta.env.VITE_SUPABASE_URL||'https://bkjdgwbrxrwgluxjuhpa.supabase.co';
export const publishableKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_WBypVF6NynmLYSuM2FZBcg_Idf_3kBm';
if(!publishableKey.startsWith('sb_publishable_'))throw new Error('Only a Supabase publishable key may be used in the website.');
export const asset=(url:string)=>`${import.meta.env.BASE_URL}${url.replace(/^\//,'')}`;
export const filing={icpNumber:import.meta.env.VITE_ICP_NUMBER||'',policeNumber:'',policeUrl:''};
