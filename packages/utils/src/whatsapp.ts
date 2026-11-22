import { DecisaoEnvioWhatsapp, MomentoLembrete, SituacaoLembrete } from '@azit/types';
import { diasCalendarioEntre, isoParaBR, partesBrasil } from './datas';
import { formatCurrency, primeiroNome } from './formatters';

// ============================================================
// WhatsApp enxuto — regras ÚNICAS (Regra 16) do canal (doc 02 §23), das
// Conversas (§24) e dos lembretes de pagamento (§28). Tudo puro: o backend
// decide com estas funções e a tela mostra com elas; nenhuma das duas reescreve
// a regra.
// ============================================================

// ---------------- Número canônico (§24 item 2) ----------------

// WhatsApp → forma CANÔNICA: 55 + DDD + celular COM o nono dígito, só dígitos.
// A Meta às vezes informa números brasileiros sem o nono dígito (wa_id de 12
// dígitos); a conversa precisa casar com o cadastro e com os lembretes
// enviados. Devolve null se não for um número brasileiro plausível.
export function normalizarWhatsapp(bruto: string | null | undefined): string | null {
  let d = (bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  // 55 + DDD + 8 dígitos começando em 6–9 = celular sem o nono dígito.
  if (d.length === 12 && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

// Formas em que o MESMO número pode estar gravado no cadastro (com/sem DDI,
// com/sem nono dígito) — para achar o titular de uma conversa.
export function variantesWhatsapp(canonico: string): string[] {
  const local = canonico.slice(2); // DDD + número
  const semNono = local.length === 11 ? `${local.slice(0, 2)}${local.slice(3)}` : null;
  return [...new Set([canonico, local, ...(semNono ? [semNono, `55${semNono}`] : [])])];
}

// '5511987654321' → '(11) 98765-4321' (o que não for celular BR sai como +dígitos).
export function formatarWhatsapp(numero: string | null | undefined): string {
  const n = (numero ?? '').replace(/\D/g, '');
  if (n.length === 13 && n.startsWith('55')) return `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  if (n.length === 12 && n.startsWith('55')) return `(${n.slice(2, 4)}) ${n.slice(4, 8)}-${n.slice(8)}`;
  return n ? `+${n}` : '';
}

// ---------------- Regra única de envio (§23.1 e §23.2) ----------------

export interface ContextoEnvioWhatsapp {
  producao: boolean;
  credencialConfigurada: boolean; // id do número + token de acesso
  destino: string; // canônico
  numerosAutorizados: string[]; // canônicos; só valem fora de produção
}

export interface ResultadoDecisaoEnvio {
  decisao: DecisaoEnvioWhatsapp;
  motivo: string | null; // por que NÃO saiu de verdade (null quando ENVIA)
}

// Produção nunca simula: sem credencial, RETÉM. Fora de produção só sai de
// verdade para número autorizado; o resto vira SIMULADO.
export function decidirEnvioWhatsapp(c: ContextoEnvioWhatsapp): ResultadoDecisaoEnvio {
  if (c.producao) {
    return c.credencialConfigurada
      ? { decisao: DecisaoEnvioWhatsapp.ENVIA, motivo: null }
      : { decisao: DecisaoEnvioWhatsapp.RETIDO, motivo: 'WhatsApp sem credencial em produção — nada foi enviado' };
  }
  if (!c.credencialConfigurada) {
    return { decisao: DecisaoEnvioWhatsapp.SIMULADO, motivo: 'ambiente sem credencial do WhatsApp — nada foi enviado' };
  }
  if (!c.numerosAutorizados.includes(c.destino)) {
    return {
      decisao: DecisaoEnvioWhatsapp.SIMULADO,
      motivo: `${formatarWhatsapp(c.destino)} não está entre os números autorizados deste ambiente de teste — nada foi enviado`,
    };
  }
  return { decisao: DecisaoEnvioWhatsapp.ENVIA, motivo: null };
}

// Lista de números autorizados digitada na tela → canônicos sem repetição, e
// o que não é número válido (a tela recusa e mostra quais).
export function normalizarNumerosAutorizados(brutos: string[]): { numeros: string[]; invalidos: string[] } {
  const numeros: string[] = [];
  const invalidos: string[] = [];
  for (const b of brutos) {
    const t = (b ?? '').trim();
    if (!t) continue;
    const n = normalizarWhatsapp(t);
    if (!n) invalidos.push(t);
    else if (!numeros.includes(n)) numeros.push(n);
  }
  return { numeros, invalidos };
}

// ---------------- Janela de 24 h do texto livre (§24 item 3) ----------------

export const JANELA_RESPOSTA_WHATSAPP_HORAS = 24;
const HORA_MS = 3_600_000;

// Texto livre só pode sair até 24 h depois da ÚLTIMA mensagem do cliente.
export function janelaRespostaWhatsapp(ultimaEntrada: Date | null | undefined, agora: Date): { aberta: boolean; ate: Date | null } {
  if (!ultimaEntrada) return { aberta: false, ate: null };
  const ate = new Date(ultimaEntrada.getTime() + JANELA_RESPOSTA_WHATSAPP_HORAS * HORA_MS);
  return { aberta: ate.getTime() > agora.getTime(), ate };
}

// ---------------- Lembretes de pagamento (§28) ----------------

// Janela de envio: todo dia, das 9h às 20h, no fuso do Brasil (Regra 15).
export const LEMBRETE_HORA_INICIO = 9;
export const LEMBRETE_HORA_FIM = 20; // exclusivo: a última rodada é a das 19h
export const LEMBRETE_DIAS_ANTES = 2;
// Aviso de atraso (§28.6, decisão Luís 22/11): uma vez só, 2 dias depois do
// vencimento; dali em diante o caso é da cobrança humana.
export const LEMBRETE_DIAS_ATRASO = 2;

export function dentroDaJanelaLembrete(instante: Date): boolean {
  const { hora } = partesBrasil(instante);
  return hora >= LEMBRETE_HORA_INICIO && hora < LEMBRETE_HORA_FIM;
}

// Momento que a fatura vive HOJE: D-2 (vence daqui a 2 dias), D0 (vence hoje),
// D+2 (venceu há 2 dias) ou nenhum. Momento perdido não é enviado com atraso.
export function momentoLembreteDaFatura(vencimentoISO: string, hojeISO: string): MomentoLembrete | null {
  const dias = diasCalendarioEntre(hojeISO, vencimentoISO);
  if (dias === LEMBRETE_DIAS_ANTES) return MomentoLembrete.D_MENOS_2;
  if (dias === 0) return MomentoLembrete.D_ZERO;
  if (dias === -LEMBRETE_DIAS_ATRASO) return MomentoLembrete.D_MAIS_2;
  return null;
}

export interface FaturaParaLembrete {
  status: string; // status REAL da fatura
  saldoCentavos: number; // valor em aberto (total − pago)
  acordoId: string | null;
  parcelas: { acordoId: string | null }[];
  tokenPublico: string | null;
}

// "Só manda se ainda devo" (§28.1): fatura FECHADA, com saldo, fora de acordo e
// com link. Devolve o motivo quando não é elegível (a tela e o teste leem).
export function faturaElegivelLembrete(f: FaturaParaLembrete): { elegivel: boolean; motivo: string | null } {
  if (f.status !== 'FECHADA') return { elegivel: false, motivo: 'fatura não está em aberto' };
  if (f.saldoCentavos <= 0) return { elegivel: false, motivo: 'fatura sem saldo em aberto' };
  if (f.acordoId || (f.parcelas.length > 0 && f.parcelas.every((p) => !!p.acordoId))) {
    return { elegivel: false, motivo: 'fatura coberta por acordo' };
  }
  if (!f.tokenPublico) return { elegivel: false, motivo: 'fatura sem link público' };
  return { elegivel: true, motivo: null };
}

// Texto do corpo de cada modelo, COMO É CADASTRADO NA META (variáveis
// numeradas). Fonte única: o backend monta o texto enviado a partir daqui e a
// tela de configuração mostra o que cadastrar. TEXTO PROVISÓRIO até a revisão
// do jurídico/V4 (doc 02 §32.10 item 3); vocabulário de 24/10 (sem "financiar",
// "taxa", "juros"). A Meta não aceita corpo que comece ou termine em variável.
export const CORPO_MODELO_LEMBRETE: Record<MomentoLembrete, string> = {
  [MomentoLembrete.D_MENOS_2]:
    'Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, de {{3}}, vence em {{4}}. ' +
    'Toque no botão abaixo para ver os itens e pagar com Pix. O valor da página é atualizado em tempo real.',
  [MomentoLembrete.D_ZERO]:
    'Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, de {{3}}, vence hoje ({{4}}). ' +
    'Toque no botão abaixo para pagar com Pix. Se já pagou, desconsidere esta mensagem.',
  // §28.6 — texto aprovado pelo Luís em 22/11. Ordem das variáveis DIFERENTE dos
  // outros: {{3}} vencimento, {{4}} valor atualizado de hoje.
  [MomentoLembrete.D_MAIS_2]:
    'Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, que venceu em {{3}}, ainda não foi paga. ' +
    'Hoje o valor é {{4}}. Pague pelo botão abaixo para evitar o bloqueio do seu veículo.',
};

// Rótulo do botão de link do modelo (limite da Meta: 25 caracteres).
export const BOTAO_MODELO_LEMBRETE = 'Ver fatura';

// Nomes padrão dos modelos na Meta (parametrizáveis por ambiente — §23.3).
export const MODELO_PADRAO_LEMBRETE: Record<MomentoLembrete, string> = {
  [MomentoLembrete.D_MENOS_2]: 'azit_fatura_disponivel',
  [MomentoLembrete.D_ZERO]: 'azit_fatura_vence_hoje',
  [MomentoLembrete.D_MAIS_2]: 'azit_fatura_atraso',
};
export const IDIOMA_PADRAO_MODELO = 'pt_BR';

// ---------------- Pix copia e cola na mensagem (§28.6) ----------------

// Momentos em que o Pix pode ir na mensagem. O D+2 não leva: o valor muda
// todo dia com os encargos (decisão Luís 22/11).
export type MomentoLembretePix = MomentoLembrete.D_MENOS_2 | MomentoLembrete.D_ZERO;
export const MOMENTOS_LEMBRETE_PIX: MomentoLembretePix[] = [MomentoLembrete.D_MENOS_2, MomentoLembrete.D_ZERO];

// Modelo "detalhes do pedido" da Meta: UM botão fixo ("Copiar código Pix") —
// a Meta não aceita botão de link junto, então o link da fatura vai INTEIRO no
// texto ({{5}}). Por isso os mesmos modelos servem aos dois ambientes (sem "_hml").
export const CORPO_MODELO_LEMBRETE_PIX: Record<MomentoLembretePix, string> = {
  [MomentoLembrete.D_MENOS_2]:
    'Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, de {{3}}, vence em {{4}}. ' +
    'Toque em Copiar código Pix e pague no app do seu banco. Para ver os itens ou pagar outro valor, acesse {{5}} e escolha como pagar.',
  [MomentoLembrete.D_ZERO]:
    'Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, de {{3}}, vence hoje ({{4}}). ' +
    'Toque em Copiar código Pix e pague no app do seu banco. Se já pagou, desconsidere esta mensagem. ' +
    'Para ver os itens ou pagar outro valor, acesse {{5}} e escolha como pagar.',
};
export const MODELO_PADRAO_LEMBRETE_PIX: Record<MomentoLembretePix, string> = {
  [MomentoLembrete.D_MENOS_2]: 'azit_fatura_pix_disponivel',
  [MomentoLembrete.D_ZERO]: 'azit_fatura_pix_vence_hoje',
};
// Nome do recebedor no cartão do Pix: a razão social do cartão CNPJ (decisão
// Luís 22/11). Padrão provisório e parametrizável em Configuração › WhatsApp.
export const RECEBEDOR_PIX_PADRAO = 'AZIT COMERCIO DE VEICULOS LTDA';

export interface ContaParaPixNoLembrete {
  momento: MomentoLembrete;
  faturaId: string;
  modeloEncargo: string; // da fatura do lembrete: só AZIT tem Pix sob demanda
  faturasEmAberto: string[]; // ids das faturas fechadas com saldo na conta (todos os modelos)
}

// Quem recebe o Pix na mensagem: D-2 ou D0, fatura do modelo AZIT e UMA ÚNICA
// fatura em aberto na conta (com duas ou mais o cliente escolhe na página).
// Devolve o motivo quando não cabe — o lembrete sai só com o link.
export function pixCabeNoLembrete(c: ContaParaPixNoLembrete): { cabe: boolean; motivo: string | null } {
  if (!(MOMENTOS_LEMBRETE_PIX as string[]).includes(c.momento)) return { cabe: false, motivo: 'o aviso de atraso não leva Pix' };
  if (c.modeloEncargo !== 'AZIT') return { cabe: false, motivo: 'fatura do modelo antigo (cobrança no Asaas)' };
  if (c.faturasEmAberto.length !== 1 || c.faturasEmAberto[0] !== c.faturaId) {
    return { cabe: false, motivo: 'conta com mais de uma fatura em aberto — o cliente escolhe na página' };
  }
  return { cabe: true, motivo: null };
}

// Fora de produção o padrão leva o sufixo: o botão do modelo aponta para o
// domínio de homologação da Fatura Azit, e o modelo de produção não serve lá.
export const SUFIXO_MODELO_FORA_DE_PRODUCAO = '_hml';
export function modeloPadraoLembrete(momento: MomentoLembrete, producao: boolean): string {
  return `${MODELO_PADRAO_LEMBRETE[momento]}${producao ? '' : SUFIXO_MODELO_FORA_DE_PRODUCAO}`;
}

export interface DadosLembrete {
  nomeTitular: string;
  numeroFatura: number;
  valorCentavos: number; // SALDO em aberto (no D+2, o valor atualizado de hoje)
  vencimentoISO: string;
}

// A Meta recusa quebra de linha e tabulação em variável — normaliza espaços
// (inclusive o espaço não separável do "R$ 699,00").
function limparVariavel(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

// Variáveis do corpo, NA ORDEM do modelo do momento: {{1}} primeiro nome, {{2}}
// número da fatura e — no D-2/D0 — {{3}} valor, {{4}} vencimento; no D+2 o
// contrário ({{3}} vencimento, {{4}} valor de hoje).
export function variaveisLembrete(d: DadosLembrete, momento: MomentoLembrete = MomentoLembrete.D_MENOS_2): string[] {
  const nome = primeiroNome(d.nomeTitular) || 'cliente';
  const valor = formatCurrency(d.valorCentavos);
  const venc = isoParaBR(d.vencimentoISO);
  const vars = momento === MomentoLembrete.D_MAIS_2 ? [nome, String(d.numeroFatura), venc, valor] : [nome, String(d.numeroFatura), valor, venc];
  return vars.map(limparVariavel);
}

function preencher(corpo: string, vars: string[]): string {
  return corpo.replace(/\{\{(\d)\}\}/g, (_m, i: string) => vars[Number(i) - 1] ?? '');
}

// Texto que o cliente recebe (corpo do modelo com as variáveis preenchidas) —
// é o que fica gravado no lembrete para o operador ver.
export function textoLembrete(momento: MomentoLembrete, d: DadosLembrete): string {
  return preencher(CORPO_MODELO_LEMBRETE[momento], variaveisLembrete(d, momento));
}

// Modelo com o Pix (§28.6): as quatro de sempre + {{5}} o link inteiro da fatura.
export function variaveisLembretePix(d: DadosLembrete, linkFatura: string): string[] {
  return [...variaveisLembrete(d, MomentoLembrete.D_MENOS_2), limparVariavel(linkFatura)];
}

export function textoLembretePix(momento: MomentoLembretePix, d: DadosLembrete, linkFatura: string): string {
  return preencher(CORPO_MODELO_LEMBRETE_PIX[momento], variaveisLembretePix(d, linkFatura));
}

// Situação nova do lembrete ao chegar um status da Meta (sent | delivered |
// read | failed). Nunca regride: LIDO não volta a ENTREGUE; lembrete que não
// saiu (SIMULADO/RETIDO) não muda. null = nada a alterar.
export function situacaoLembreteAposStatusMeta(atual: string, statusMeta: string): SituacaoLembrete | null {
  if (atual === SituacaoLembrete.SIMULADO || atual === SituacaoLembrete.RETIDO) return null;
  const ordem: string[] = [SituacaoLembrete.PREPARADO, SituacaoLembrete.ENVIADO, SituacaoLembrete.ENTREGUE, SituacaoLembrete.LIDO];
  const alvo =
    statusMeta === 'sent' ? SituacaoLembrete.ENVIADO
    : statusMeta === 'delivered' ? SituacaoLembrete.ENTREGUE
    : statusMeta === 'read' ? SituacaoLembrete.LIDO
    : statusMeta === 'failed' ? SituacaoLembrete.FALHOU
    : null;
  if (!alvo) return null;
  if (alvo === SituacaoLembrete.FALHOU) return atual === SituacaoLembrete.LIDO || atual === SituacaoLembrete.ENTREGUE ? null : SituacaoLembrete.FALHOU;
  if (atual === SituacaoLembrete.FALHOU) return alvo; // a Meta confirmou depois de uma falha registrada
  return ordem.indexOf(alvo) > ordem.indexOf(atual) ? alvo : null;
}

// Mesma regra para a mensagem de SAÍDA da conversa (situação em minúsculas).
export function situacaoMensagemAposStatusMeta(atual: string | null, statusMeta: string): string | null {
  if (atual === 'simulada' || atual === 'retida') return null;
  const ordem = ['enviando', 'enviada', 'entregue', 'lida'];
  const alvo = statusMeta === 'sent' ? 'enviada' : statusMeta === 'delivered' ? 'entregue' : statusMeta === 'read' ? 'lida' : statusMeta === 'failed' ? 'falhou' : null;
  if (!alvo) return null;
  if (alvo === 'falhou') return atual === 'lida' || atual === 'entregue' ? null : 'falhou';
  if (atual === 'falhou' || atual === null) return alvo;
  return ordem.indexOf(alvo) > ordem.indexOf(atual) ? alvo : null;
}
