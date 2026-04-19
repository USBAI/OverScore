/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY: string;
  readonly VITE_OPENROUTER_MODEL?: string;
  readonly VITE_OPENROUTER_FALLBACK_MODEL?: string;
  readonly VITE_SPORTSDB_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
