// Casamento do modelo do NOSSO cadastro com o nome que a FIPE usa.
// Nosso: "HB20S 1.0 COMFORT" · FIPE: "HB20S Comfort 1.0  Flex 12V Mec."
// Regra: a primeira palavra (família do modelo) tem que ser a mesma; todas as
// nossas palavras têm que aparecer no rótulo da FIPE; entre os que passam,
// vence o que tem MENOS palavras sobrando (o mais próximo do que escrevemos) e,
// no empate, câmbio manual e sem turbo (perfil da frota). Sem candidato que
// contenha todas as palavras → null: melhor não preencher do que preencher errado.

export interface ModeloFipe { Label: string; Value: string | number }

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (s: string) => norm(s).split(' ').filter(Boolean);

export function escolherModeloFipe(nossoModelo: string, candidatos: ModeloFipe[]): { modelo: ModeloFipe; sobras: number; alternativas: ModeloFipe[] } | null {
  const nossas = palavras(nossoModelo);
  // Só a família ("HB20") não identifica a versão — e a FIPE muda muito entre
  // versões. Exige a família + pelo menos mais uma palavra.
  if (nossas.length < 2) return null;
  const pontuados = candidatos
    .map((m) => {
      const dele = palavras(m.Label);
      if (dele[0] !== nossas[0]) return null; // família do modelo
      if (!nossas.every((p) => dele.includes(p))) return null; // todas as nossas palavras
      const sobras = dele.filter((p) => !nossas.includes(p));
      // desempate: manual antes de automático, aspirado antes de turbo
      const penalidade = (sobras.includes('aut.') || sobras.includes('aut') ? 1 : 0) + (sobras.includes('tb') ? 1 : 0);
      return { modelo: m, sobras: sobras.length, penalidade };
    })
    .filter((x): x is { modelo: ModeloFipe; sobras: number; penalidade: number } => !!x)
    .sort((a, b) => a.sobras - b.sobras || a.penalidade - b.penalidade);
  if (!pontuados.length) return null;
  return { modelo: pontuados[0].modelo, sobras: pontuados[0].sobras, alternativas: pontuados.slice(1, 4).map((x) => x.modelo) };
}

// "R$ 75.358,00" → 7535800 centavos
export function valorFipeParaCentavos(valor: string): number | null {
  const m = valor.replace(/[^\d,]/g, '').replace(',', '.');
  const n = Math.round(parseFloat(m) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
}
