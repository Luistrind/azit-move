// Datas do lado do operador. "Hoje" é o do NEGÓCIO — America/Sao_Paulo
// (Regra 15, 20/10/2026) — nunca o relógio do navegador nem UTC: as mesmas
// funções de @azit/utils que o backend usa, para a tela e o servidor nunca
// discordarem sobre que dia é. Armadilhas que isto evita:
// (1) `new Date('YYYY-MM-DD')` parseia como UTC e "volta" um dia no fuso local;
// (2) `new Date().toISOString().slice(0,10)` devolve a data UTC — depois das
//     21h (UTC-3) já é amanhã.
import {
  dataHojeBrasil, diaBrasil, diaDeColunaMista, diasCalendarioEntre, diaSemanaISO, FUSO_NEGOCIO, isoParaBR,
  somarDiasISO as somarDias,
} from '@azit/utils';

// ---- Exibição (a API entrega datas como ISO completo) --------------------
// Coluna de DATA (vencimento, 1ª parcela, fechamento): o dia é o do calendário
// gravado — nunca passar por `new Date(iso).toLocaleDateString()`, que em
// Brasília volta um dia para meia-noite UTC.
export function dataBR(iso: string | null | undefined): string {
  return iso ? isoParaBR(iso) : '—';
}

// INSTANTE (createdAt, anexadoEm, assinouEm…) → 'DD/MM/YYYY' no fuso do negócio.
export function instanteBR(iso: string | null | undefined): string {
  return iso ? isoParaBR(diaBrasil(new Date(iso))) : '—';
}

// INSTANTE → 'HH:mm' no fuso do negócio.
export function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO_NEGOCIO, hour: '2-digit', minute: '2-digit' });
}

// INSTANTE → 'DD/MM HH:mm' no fuso do negócio (listas compactas).
export function instanteCurtoBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO_NEGOCIO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Coluna MISTA (dia escolhido na tela OU now(); ex.: lançamento do centro de
// custo, vigência de oferta) — ver diaDeColunaMista em @azit/utils.
export function dataMistaBR(iso: string | null | undefined): string {
  return iso ? isoParaBR(diaDeColunaMista(new Date(iso))) : '—';
}

// 'YYYY-MM-DD' de hoje no fuso do negócio.
export function hojeBrasilISO(): string {
  return dataHojeBrasil();
}

// 'YYYY-MM-DD' somando N dias de calendário a uma base (default: hoje).
export function somarDiasISO(dias: number, base?: string): string {
  return somarDias(base ?? hojeBrasilISO(), dias);
}

// 'YYYY-MM-DD' da próxima segunda-feira (padrão do vencimento p/ motoristas).
export function proximaSegundaISO(): string {
  const hoje = hojeBrasilISO();
  return somarDias(hoje, ((8 - diaSemanaISO(hoje)) % 7) || 7);
}

// Dias de atraso de um vencimento (ISO da API, dia-calendário) em relação a
// hoje, por CALENDÁRIO.
export function diasAtrasoBrasil(iso: string): number {
  return Math.max(0, diasCalendarioEntre(iso.slice(0, 10), hojeBrasilISO()));
}

// ---- Exibição de INSTANTES (createdAt, assinouEm, dataEfetivacao…) ---------
// Sempre no fuso do NEGÓCIO (America/Sao_Paulo — Regra 15), nunca no relógio
// do navegador. Mesmos nomes/assinaturas da branch fix/datas-fuso-brasil, que
// reescreve este arquivo sobre @azit/utils — na integração, fique com a dela.
const FUSO_NEGOCIO = 'America/Sao_Paulo';

// INSTANTE → 'DD/MM/YYYY' no fuso do negócio.
export function instanteBR(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO_NEGOCIO, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

// INSTANTE → 'HH:mm' no fuso do negócio.
export function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO_NEGOCIO, hour: '2-digit', minute: '2-digit' });
}

// Tempo relativo curto para o sino ("agora", "há 5 min", "há 2 h", "ontem", dd/mm).
export function tempoRelativo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  if (h < 48) return 'ontem';
  const [, m, d] = diaBrasil(new Date(iso)).split('-');
  return `${d}/${m}`;
}
