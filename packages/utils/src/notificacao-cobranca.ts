// ============================================================
// Notificações formais de cobrança — POP-COB-001 (doc 02 §23, decisão Luís
// 19/09). Motor PURO: dado o estado do caso (vencimentos em atraso, o que já
// foi enviado, retomada, jurídico) e o relógio, decide qual notificação é a
// próxima, a partir de quando, e se sai AGORA (janela de envio incluída).
// Sem banco, sem rede — o backend só alimenta e executa.
// ============================================================

export type EtapaNotificacao = 1 | 2 | 3 | 4 | 5 | 6;

export const ETAPAS_NOTIFICACAO: Record<EtapaNotificacao, { titulo: string; resumo: string; anexo: string }> = {
  1: { titulo: '1ª Notificação', resumo: 'Parcela em aberto', anexo: 'I' },
  2: { titulo: '2ª Notificação', resumo: 'Reiteração e convite para negociar', anexo: 'II' },
  3: { titulo: '3ª Notificação', resumo: 'Duas parcelas vencidas', anexo: 'III' },
  4: { titulo: '4ª Notificação', resumo: 'Pré-bloqueio', anexo: 'IV' },
  5: { titulo: '5ª Notificação', resumo: 'Após a retomada', anexo: 'V' },
  6: { titulo: '6ª Notificação', resumo: 'Rescisão contratual', anexo: 'VI' },
};

const HORA_MS = 3_600_000;
export const INTERVALO_2A_HORAS = 72; // POP §8: 72h após a 1ª
export const INTERVALO_4A_HORAS = 72; // POP §12: 72h após a 3ª
export const PRAZO_BLOQUEIO_HORAS = 24; // POP §13: 24h após a 4ª
export const JANELA_ENVIO = { horaInicio: 9, horaFim: 17 }; // dias úteis (cl. 1.1)

// ---------- Calendário (America/Sao_Paulo) ----------

// Partes da data/hora no fuso do negócio.
function partesSP(d: Date): { iso: string; hora: number; minuto: number; dow: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const dows: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { iso: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, minuto: Number(p.minute), dow: dows[p.weekday] };
}

// Instante UTC de 'YYYY-MM-DD' às HH:00 em São Paulo (UTC−3 fixo desde 2019).
function instanteSP(iso: string, hora: number): Date {
  return new Date(`${iso}T${String(hora).padStart(2, '0')}:00:00.000-03:00`);
}

function somarDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Domingo de Páscoa (algoritmo gregoriano anônimo).
function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Feriados NACIONAIS (lei federal). Estaduais/municipais: placeholder (Regra 12).
export function feriadosNacionais(ano: number): string[] {
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  return [...fixos.map((md) => `${ano}-${md}`), somarDiasISO(pascoa(ano), -2) /* Sexta-feira Santa */];
}

export function ehDiaUtilBrasil(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00.000Z`).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !feriadosNacionais(Number(iso.slice(0, 4))).includes(iso);
}

export function dentroJanelaEnvio(agora: Date): boolean {
  const p = partesSP(agora);
  return ehDiaUtilBrasil(p.iso) && p.hora >= JANELA_ENVIO.horaInicio && p.hora < JANELA_ENVIO.horaFim;
}

// Primeiro instante >= `d` dentro da janela de envio.
export function ajustarParaJanela(d: Date): Date {
  if (dentroJanelaEnvio(d)) return d;
  const p = partesSP(d);
  let iso = p.iso;
  // Ainda hoje antes da abertura (e hoje é útil)? abre hoje às 9h.
  if (ehDiaUtilBrasil(iso) && p.hora < JANELA_ENVIO.horaInicio) return instanteSP(iso, JANELA_ENVIO.horaInicio);
  do { iso = somarDiasISO(iso, 1); } while (!ehDiaUtilBrasil(iso));
  return instanteSP(iso, JANELA_ENVIO.horaInicio);
}

export function dataSP(d: Date): string {
  return partesSP(d).iso;
}

// ---------- Avaliação do caso ----------

export interface EstadoCasoCobranca {
  // Vencimentos DISTINTOS ('YYYY-MM-DD') com parcela em aberto, fora de acordo,
  // já vencidos. Linhas do mesmo vencimento (veículo + proteção) = 1 parcela.
  vencimentosEmAtraso: string[];
  diasAtraso: number; // do vencimento mais antigo (calendário)
  // Quando cada etapa foi efetivamente enviada NESTE caso (falha não conta).
  enviadas: Partial<Record<EtapaNotificacao, Date>>;
  veiculoRetomadoEm: Date | null;
  noJuridico: boolean;
  agora: Date;
  // Só ferramentas de teste (homolog): dispensa a janela de dias úteis 9h–17h.
  ignorarJanela?: boolean;
}

export type FaseCaso =
  | 'ordinaria' // 1 parcela: 1ª/2ª + contato diário
  | 'escalonamento' // 2+ parcelas: 3ª enviada, monitoramento
  | 'pre_bloqueio' // 4ª enviada, correndo as 24h
  | 'bloqueio_liberado'
  | 'pos_retomada'
  | 'juridico';

export interface ProximaNotificacao {
  etapa: EtapaNotificacao;
  // Quando pode sair (já ajustado à janela). null = depende de um EVENTO.
  prevista: Date | null;
  condicao: string; // texto para o operador
}

export interface AvaliacaoCaso {
  fase: FaseCaso;
  ultimaEtapa: EtapaNotificacao | null;
  proxima: ProximaNotificacao | null;
  enviarAgora: EtapaNotificacao | null;
  monitorarVeiculo: boolean;
  bloqueioLiberadoEm: Date | null;
  bloqueioLiberado: boolean;
  rescisaoSinalizada: boolean;
}

const mais = (d: Date, horas: number) => new Date(d.getTime() + horas * HORA_MS);

export function avaliarCasoCobranca(e: EstadoCasoCobranca): AvaliacaoCaso {
  const env = e.enviadas;
  const n = e.vencimentosEmAtraso.length;
  const etapasEnviadas = (Object.keys(env).map(Number) as EtapaNotificacao[]).filter((k) => env[k]);
  const ultimaEtapa = etapasEnviadas.length ? (Math.max(...etapasEnviadas) as EtapaNotificacao) : null;
  const bloqueioLiberadoEm = env[4] ? mais(env[4], PRAZO_BLOQUEIO_HORAS) : null;
  const bloqueioLiberado = !!bloqueioLiberadoEm && e.agora >= bloqueioLiberadoEm;
  const rescisaoSinalizada = e.diasAtraso > 30 || n >= 4;
  const monitorarVeiculo = !!env[3];

  const base = { ultimaEtapa, monitorarVeiculo, bloqueioLiberadoEm, bloqueioLiberado, rescisaoSinalizada };

  if (e.noJuridico || env[6]) {
    return { ...base, fase: 'juridico', proxima: null, enviarAgora: null };
  }

  let proxima: ProximaNotificacao | null = null;
  let fase: FaseCaso = 'ordinaria';

  if (e.veiculoRetomadoEm || env[5]) {
    fase = 'pos_retomada';
    if (!env[5] && e.veiculoRetomadoEm) {
      proxima = { etapa: 5, prevista: e.veiculoRetomadoEm, condicao: 'Retomada registrada' };
    }
  } else if (n === 0) {
    proxima = null; // regularizado — o caso encerra na varredura
  } else if (!env[1]) {
    proxima = { etapa: 1, prevista: e.agora, condicao: 'Parcela vencida (D1)' };
  } else if (!env[2]) {
    proxima = { etapa: 2, prevista: mais(env[1], INTERVALO_2A_HORAS), condicao: '72h após a 1ª notificação' };
  } else if (!env[3]) {
    proxima = n >= 2
      ? { etapa: 3, prevista: e.agora, condicao: 'Duas parcelas vencidas' }
      : { etapa: 3, prevista: null, condicao: 'Aguarda uma 2ª parcela vencida' };
  } else if (!env[4]) {
    fase = n >= 2 ? 'escalonamento' : 'ordinaria';
    proxima = n >= 2
      ? { etapa: 4, prevista: mais(env[3], INTERVALO_4A_HORAS), condicao: '72h após a 3ª notificação' }
      : { etapa: 4, prevista: null, condicao: 'Suspensa: só 1 parcela vencida (POP §9)' };
  } else {
    fase = bloqueioLiberado ? 'bloqueio_liberado' : 'pre_bloqueio';
    proxima = { etapa: 5, prevista: null, condicao: 'Após a retomada do veículo' };
  }

  // No máximo UMA notificação por caso por dia (evita rajada — ex.: 2ª e 3ª
  // no mesmo dia quando o caso já nasce com 2 parcelas vencidas).
  if (proxima?.prevista) {
    const hoje = dataSP(e.agora);
    const jaHoje = etapasEnviadas.some((k) => dataSP(env[k] as Date) === hoje);
    let alvo = proxima.prevista < e.agora ? e.agora : proxima.prevista;
    if (jaHoje && dataSP(alvo) === hoje) alvo = instanteSP(somarDiasISO(hoje, 1), 0);
    proxima = { ...proxima, prevista: e.ignorarJanela ? alvo : ajustarParaJanela(alvo) };
  }

  const enviarAgora =
    proxima?.prevista && proxima.prevista <= e.agora && (e.ignorarJanela || dentroJanelaEnvio(e.agora)) ? proxima.etapa : null;

  return { ...base, fase, proxima, enviarAgora };
}

// Vencimentos distintos a partir das parcelas (linhas) em atraso.
export function vencimentosDistintos(datas: Date[]): string[] {
  return [...new Set(datas.map((d) => d.toISOString().slice(0, 10)))].sort();
}
