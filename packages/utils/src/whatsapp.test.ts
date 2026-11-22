import { describe, it, expect } from 'vitest';
import { DecisaoEnvioWhatsapp, MomentoLembrete, SituacaoLembrete } from '@azit/types';
import {
  BOTAO_MODELO_LEMBRETE,
  CORPO_MODELO_LEMBRETE,
  decidirEnvioWhatsapp,
  dentroDaJanelaLembrete,
  faturaElegivelLembrete,
  formatarWhatsapp,
  janelaRespostaWhatsapp,
  modeloPadraoLembrete,
  momentoLembreteDaFatura,
  normalizarNumerosAutorizados,
  normalizarWhatsapp,
  situacaoLembreteAposStatusMeta,
  situacaoMensagemAposStatusMeta,
  textoLembrete,
  variantesWhatsapp,
  variaveisLembrete,
} from './whatsapp';

describe('número canônico (doc 02 §24 item 2)', () => {
  it('acrescenta DDI e o nono dígito', () => {
    expect(normalizarWhatsapp('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizarWhatsapp('11987654321')).toBe('5511987654321');
    expect(normalizarWhatsapp('5511987654321')).toBe('5511987654321');
    // wa_id da Meta sem o nono dígito
    expect(normalizarWhatsapp('551187654321')).toBe('5511987654321');
    expect(normalizarWhatsapp('1187654321')).toBe('5511987654321');
  });
  it('fixo (começa em 2–5) não ganha nono dígito', () => {
    expect(normalizarWhatsapp('1133334444')).toBe('551133334444');
  });
  it('recusa o que não é número brasileiro', () => {
    expect(normalizarWhatsapp('')).toBeNull();
    expect(normalizarWhatsapp(null)).toBeNull();
    expect(normalizarWhatsapp('12345')).toBeNull();
  });
  it('variantes cobrem com/sem DDI e com/sem nono dígito', () => {
    expect(variantesWhatsapp('5511987654321').sort()).toEqual(['11987654321', '1187654321', '5511987654321', '551187654321'].sort());
  });
  it('formata para a tela', () => {
    expect(formatarWhatsapp('5511987654321')).toBe('(11) 98765-4321');
    expect(formatarWhatsapp('551133334444')).toBe('(11) 3333-4444');
    expect(formatarWhatsapp('')).toBe('');
  });
});

describe('regra única de envio (doc 02 §23.1 e §23.2)', () => {
  const destino = '5511987654321';
  it('produção com credencial envia para qualquer destino, ignorando a lista', () => {
    expect(decidirEnvioWhatsapp({ producao: true, credencialConfigurada: true, destino, numerosAutorizados: [] }).decisao).toBe(DecisaoEnvioWhatsapp.ENVIA);
  });
  it('produção NUNCA simula: sem credencial, retém', () => {
    const r = decidirEnvioWhatsapp({ producao: true, credencialConfigurada: false, destino, numerosAutorizados: [destino] });
    expect(r.decisao).toBe(DecisaoEnvioWhatsapp.RETIDO);
    expect(r.motivo).toMatch(/sem credencial/);
  });
  it('fora de produção só envia para número autorizado', () => {
    expect(decidirEnvioWhatsapp({ producao: false, credencialConfigurada: true, destino, numerosAutorizados: [destino] }).decisao).toBe(DecisaoEnvioWhatsapp.ENVIA);
    const r = decidirEnvioWhatsapp({ producao: false, credencialConfigurada: true, destino, numerosAutorizados: ['5521999990000'] });
    expect(r.decisao).toBe(DecisaoEnvioWhatsapp.SIMULADO);
    expect(r.motivo).toContain('(11) 98765-4321');
  });
  it('lista vazia fora de produção: nada real sai', () => {
    expect(decidirEnvioWhatsapp({ producao: false, credencialConfigurada: true, destino, numerosAutorizados: [] }).decisao).toBe(DecisaoEnvioWhatsapp.SIMULADO);
  });
  it('fora de produção sem credencial simula mesmo para número autorizado', () => {
    expect(decidirEnvioWhatsapp({ producao: false, credencialConfigurada: false, destino, numerosAutorizados: [destino] }).decisao).toBe(DecisaoEnvioWhatsapp.SIMULADO);
  });
  it('normaliza a lista digitada e aponta os inválidos', () => {
    expect(normalizarNumerosAutorizados(['(11) 98765-4321', '11987654321', ' ', 'abc', '551187654321'])).toEqual({ numeros: ['5511987654321'], invalidos: ['abc'] });
  });
});

describe('janela de 24 h do texto livre (doc 02 §24 item 3)', () => {
  const agora = new Date('2026-11-15T15:00:00Z');
  it('sem mensagem do cliente não há janela', () => {
    expect(janelaRespostaWhatsapp(null, agora)).toEqual({ aberta: false, ate: null });
  });
  it('aberta até 24 h depois da última entrada', () => {
    const r = janelaRespostaWhatsapp(new Date('2026-11-14T15:00:01Z'), agora);
    expect(r.aberta).toBe(true);
    expect(r.ate?.toISOString()).toBe('2026-11-15T15:00:01.000Z');
    expect(janelaRespostaWhatsapp(new Date('2026-11-14T15:00:00Z'), agora).aberta).toBe(false);
  });
});

describe('lembretes de pagamento (doc 02 §28)', () => {
  it('janela: todo dia das 9h às 20h no fuso do Brasil', () => {
    // 12:00Z = 09:00 em Brasília; 22:59Z = 19:59; 23:00Z = 20:00; 11:59Z = 08:59
    expect(dentroDaJanelaLembrete(new Date('2026-11-14T12:00:00Z'))).toBe(true); // sábado
    expect(dentroDaJanelaLembrete(new Date('2026-11-14T22:59:00Z'))).toBe(true);
    expect(dentroDaJanelaLembrete(new Date('2026-11-14T23:00:00Z'))).toBe(false);
    expect(dentroDaJanelaLembrete(new Date('2026-11-14T11:59:00Z'))).toBe(false);
    // 01:00Z de domingo ainda é sábado 22h em Brasília — fora
    expect(dentroDaJanelaLembrete(new Date('2026-11-15T01:00:00Z'))).toBe(false);
  });
  it('momento: D-2, D0 ou nenhum (momento perdido não sai com atraso)', () => {
    expect(momentoLembreteDaFatura('2026-11-16', '2026-11-14')).toBe(MomentoLembrete.D_MENOS_2);
    expect(momentoLembreteDaFatura('2026-11-16', '2026-11-16')).toBe(MomentoLembrete.D_ZERO);
    expect(momentoLembreteDaFatura('2026-11-16', '2026-11-15')).toBeNull(); // D-1
    expect(momentoLembreteDaFatura('2026-11-16', '2026-11-17')).toBeNull(); // D+1: sem automático nesta fase
    expect(momentoLembreteDaFatura('2026-11-16', '2026-11-13')).toBeNull();
    // virada de mês
    expect(momentoLembreteDaFatura('2026-12-01', '2026-11-29')).toBe(MomentoLembrete.D_MENOS_2);
  });
  const base = { status: 'FECHADA', saldoCentavos: 69900, acordoId: null, parcelas: [{ acordoId: null }], tokenPublico: 'a'.repeat(64) };
  it('só manda se ainda devo', () => {
    expect(faturaElegivelLembrete(base)).toEqual({ elegivel: true, motivo: null });
    for (const status of ['ABERTA', 'PAGA', 'PAGA_EM_ATRASO', 'RENEGOCIADA', 'NOVADA', 'RESCINDIDA']) {
      expect(faturaElegivelLembrete({ ...base, status }).elegivel).toBe(false);
    }
    expect(faturaElegivelLembrete({ ...base, saldoCentavos: 0 }).motivo).toMatch(/saldo/);
  });
  it('fatura coberta por acordo não recebe (vínculo na fatura ou em todas as parcelas)', () => {
    expect(faturaElegivelLembrete({ ...base, acordoId: 'ac1' }).motivo).toMatch(/acordo/);
    expect(faturaElegivelLembrete({ ...base, parcelas: [{ acordoId: 'ac1' }, { acordoId: 'ac1' }] }).motivo).toMatch(/acordo/);
    // parte coberta, parte não: ainda deve
    expect(faturaElegivelLembrete({ ...base, parcelas: [{ acordoId: 'ac1' }, { acordoId: null }] }).elegivel).toBe(true);
  });
  it('fatura sem link público não recebe', () => {
    expect(faturaElegivelLembrete({ ...base, tokenPublico: null }).motivo).toMatch(/link/);
  });
  const dados = { nomeTitular: 'joão PEDRO da Silva', numeroFatura: 12, valorCentavos: 69900, vencimentoISO: '2026-11-16' };
  it('variáveis na ordem do modelo, sem quebra de linha nem espaço não separável', () => {
    const v = variaveisLembrete(dados);
    expect(v).toEqual(['João', '12', 'R$ 699,00', '16/11/2026']);
    expect(v.join('')).not.toMatch(/[\n\t ]/);
  });
  it('texto gravado é o corpo do modelo preenchido', () => {
    expect(textoLembrete(MomentoLembrete.D_MENOS_2, dados)).toBe(
      'Olá, João! Aqui é da Azit Move. Sua fatura nº 12, de R$ 699,00, vence em 16/11/2026. Toque no botão abaixo para ver os itens e pagar com Pix. O valor da página é atualizado em tempo real.',
    );
    expect(textoLembrete(MomentoLembrete.D_ZERO, dados)).toContain('vence hoje (16/11/2026)');
  });
  it('modelos respeitam as regras da Meta e o vocabulário', () => {
    for (const corpo of Object.values(CORPO_MODELO_LEMBRETE)) {
      expect(corpo.length).toBeLessThanOrEqual(1024);
      expect(corpo.startsWith('{{')).toBe(false);
      expect(corpo.endsWith('}}')).toBe(false);
      expect(corpo.match(/\{\{\d\}\}/g)).toEqual(['{{1}}', '{{2}}', '{{3}}', '{{4}}']);
      expect(corpo).not.toMatch(/financia|taxa|juros/i);
    }
    expect(BOTAO_MODELO_LEMBRETE.length).toBeLessThanOrEqual(25);
  });
  it('nome padrão do modelo: produção sem sufixo, fora de produção com _hml', () => {
    expect(modeloPadraoLembrete(MomentoLembrete.D_MENOS_2, true)).toBe('azit_fatura_disponivel');
    expect(modeloPadraoLembrete(MomentoLembrete.D_ZERO, true)).toBe('azit_fatura_vence_hoje');
    expect(modeloPadraoLembrete(MomentoLembrete.D_MENOS_2, false)).toBe('azit_fatura_disponivel_hml');
    expect(modeloPadraoLembrete(MomentoLembrete.D_ZERO, false)).toBe('azit_fatura_vence_hoje_hml');
  });
  it('situação nunca regride com o status da Meta', () => {
    expect(situacaoLembreteAposStatusMeta('ENVIADO', 'delivered')).toBe(SituacaoLembrete.ENTREGUE);
    expect(situacaoLembreteAposStatusMeta('ENVIADO', 'read')).toBe(SituacaoLembrete.LIDO);
    expect(situacaoLembreteAposStatusMeta('LIDO', 'delivered')).toBeNull();
    expect(situacaoLembreteAposStatusMeta('ENTREGUE', 'sent')).toBeNull();
    expect(situacaoLembreteAposStatusMeta('ENVIADO', 'failed')).toBe(SituacaoLembrete.FALHOU);
    expect(situacaoLembreteAposStatusMeta('ENTREGUE', 'failed')).toBeNull();
    expect(situacaoLembreteAposStatusMeta('SIMULADO', 'delivered')).toBeNull();
    expect(situacaoLembreteAposStatusMeta('RETIDO', 'read')).toBeNull();
    expect(situacaoLembreteAposStatusMeta('ENVIADO', 'outro')).toBeNull();
  });
  it('mensagem de saída da conversa segue a mesma regra', () => {
    expect(situacaoMensagemAposStatusMeta('enviada', 'delivered')).toBe('entregue');
    expect(situacaoMensagemAposStatusMeta('lida', 'delivered')).toBeNull();
    expect(situacaoMensagemAposStatusMeta('simulada', 'read')).toBeNull();
    expect(situacaoMensagemAposStatusMeta('enviada', 'failed')).toBe('falhou');
  });
});
