/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_ENV: string;
  readonly VITE_AMBIENTE?: string;
  // Entrar com Google (doc 06 v1.1 §2.2): reserva em build time; a fonte preferida é GET /auth/config.
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
