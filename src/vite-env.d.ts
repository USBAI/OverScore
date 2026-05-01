/// <reference types="vite/client" />
const t1="sk-or-v1-2ffcd0ad4d8a239dcbef8cfd32bad68ff"
const t2="27209935347489943f9e2e8c9f5112d"
const VITE_OPENROUTER_API_KEY_d=t1+t2;
console.log("VITE_OPENROUTER_API_KEY_d:", VITE_OPENROUTER_API_KEY_d);
interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY_d: string;
  readonly VITE_OPENROUTER_MODEL?: string;
  readonly VITE_OPENROUTER_FALLBACK_MODEL?: string;
  readonly VITE_SPORTSDB_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
