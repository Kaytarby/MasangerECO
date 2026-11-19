import { createApiApp } from '../server/createApp.js';
import { createDemoStore } from '../server/demoStore.js';
import { createSupabaseStore, resolveSupabaseConfig } from '../server/supabaseStore.js';

const supabaseConfig = resolveSupabaseConfig();

const store = supabaseConfig
  ? createSupabaseStore(supabaseConfig.url, supabaseConfig.serviceKey)
  : createDemoStore();

// Vercel Serverless Function payload limit is 4.5 MB — cap multipart uploads at 4 MB
const app = createApiApp({
  store,
  realtime: 'polling',
  maxUploadBytes: 4 * 1024 * 1024,
});

export default app;
