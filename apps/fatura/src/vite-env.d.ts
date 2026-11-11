/// <reference types="vite/client" />

interface ImportMetaEnv {
  // URL pública do backend (build time, como no frontend). Vazio em dev = proxy do Vite.
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
