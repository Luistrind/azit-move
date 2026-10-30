// Tema claro/escuro — preferência GLOBAL do usuário (doc 02 §27.6, 30/10):
// vale para o sistema inteiro, guardada no navegador, aplicada em <html>.
export type Tema = 'claro' | 'escuro';
const CHAVE = 'azit.tema';

export function temaAtual(): Tema {
  try {
    const t = localStorage.getItem(CHAVE);
    if (t === 'claro' || t === 'escuro') return t;
  } catch { /* sem storage: segue o padrão */ }
  return 'claro';
}

export function aplicarTema(t: Tema): void {
  document.documentElement.dataset.theme = t === 'escuro' ? 'dark' : 'light';
  try { localStorage.setItem(CHAVE, t); } catch { /* melhor-esforço */ }
  window.dispatchEvent(new CustomEvent('azit:tema', { detail: t }));
}

export function alternarTema(): Tema {
  const novo: Tema = temaAtual() === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(novo);
  return novo;
}

// Chamar uma vez na carga (main.tsx) para não piscar no tema errado.
export function iniciarTema(): void {
  document.documentElement.dataset.theme = temaAtual() === 'escuro' ? 'dark' : 'light';
}
