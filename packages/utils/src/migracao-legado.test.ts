import { describe, expect, it } from 'vitest';
import {
  classificarCobrancaLegada,
  decomporParcelaLegada,
  PARCELA_LEGADA_HB20,
  PARCELA_LEGADA_MOBI_KWID,
  triarCasoLegado,
} from './migracao-legado';

const HOJE = '2026-09-21';
const paga = (vencimento: string, valor = PARCELA_LEGADA_HB20) => ({ valor, vencimento, status: 'RECEIVED', pagoEm: vencimento });
const pendente = (vencimento: string, valor = PARCELA_LEGADA_HB20) => ({ valor, vencimento, status: 'PENDING' });
const ativa = { status: 'ACTIVE', valor: PARCELA_LEGADA_HB20, ciclo: 'WEEKLY' };

describe('classificarCobrancaLegada', () => {
  it('paga por qualquer status de recebimento', () => {
    expect(classificarCobrancaLegada({ valor: 1, vencimento: '2026-01-01', status: 'CONFIRMED' }, HOJE)).toBe('paga');
    expect(classificarCobrancaLegada({ valor: 1, vencimento: '2026-01-01', status: 'RECEIVED_IN_CASH' }, HOJE)).toBe('paga');
  });
  it('em aberto: a data decide entre pendente e vencida, não o status do Asaas', () => {
    expect(classificarCobrancaLegada(pendente('2026-09-28'), HOJE)).toBe('pendente');
    expect(classificarCobrancaLegada(pendente('2026-09-14'), HOJE)).toBe('vencida');
    expect(classificarCobrancaLegada({ ...pendente('2026-09-28'), status: 'OVERDUE' }, HOJE)).toBe('pendente');
  });
  it('apagada ou estornada é "outra" e não conta', () => {
    expect(classificarCobrancaLegada({ ...paga('2026-01-01'), deletada: true }, HOJE)).toBe('outra');
    expect(classificarCobrancaLegada({ valor: 1, vencimento: '2026-01-01', status: 'REFUNDED' }, HOJE)).toBe('outra');
  });
});

describe('triarCasoLegado', () => {
  it('ativo sem vencida: prioridade 1, parcela padrão e modelo sugerido', () => {
    const t = triarCasoLegado({
      assinaturas: [ativa],
      cobrancas: [paga('2026-08-31'), paga('2026-09-07'), paga('2026-09-14'), pendente('2026-09-28')],
      hoje: HOJE,
    });
    expect(t.situacao).toBe('SEM_VENCIDA');
    expect(t.prioridade).toBe(1);
    expect(t.cobrancasPagas).toBe(3);
    expect(t.cobrancasPendentes).toBe(1);
    expect(t.cobrancasVencidas).toBe(0);
    expect(t.valorParcelaPadrao).toBe(PARCELA_LEGADA_HB20);
    expect(t.modeloSugerido).toBe('HB20');
    expect(t.primeiraCobrancaEm).toBe('2026-08-31');
    expect(t.ultimaCobrancaEm).toBe('2026-09-28');
  });

  it('com vencida vai para depois dos sem vencida', () => {
    const t = triarCasoLegado({ assinaturas: [ativa], cobrancas: [paga('2026-08-31'), pendente('2026-09-07')], hoje: HOJE });
    expect(t.situacao).toBe('COM_VENCIDA');
    expect(t.prioridade).toBe(2);
    expect(t.cobrancasVencidas).toBe(1);
  });

  it('sem assinatura ativa e nada em aberto = sem movimento (sugestão de descarte)', () => {
    const t = triarCasoLegado({
      assinaturas: [{ ...ativa, status: 'INACTIVE' }],
      cobrancas: [paga('2026-03-02'), paga('2026-03-09')],
      hoje: HOJE,
    });
    expect(t.situacao).toBe('SEM_MOVIMENTO');
    expect(t.prioridade).toBe(3);
    expect(t.assinaturaAtiva).toBe(false);
  });

  it('a parcela padrão é o valor mais frequente; entrada diferente não engana', () => {
    const t = triarCasoLegado({
      assinaturas: [{ ...ativa, valor: PARCELA_LEGADA_MOBI_KWID }],
      cobrancas: [paga('2026-08-03', 500_000), paga('2026-08-10', PARCELA_LEGADA_MOBI_KWID), paga('2026-08-17', PARCELA_LEGADA_MOBI_KWID), pendente('2026-09-28', PARCELA_LEGADA_MOBI_KWID)],
      hoje: HOJE,
    });
    expect(t.valorParcelaPadrao).toBe(PARCELA_LEGADA_MOBI_KWID);
    expect(t.modeloSugerido).toBe('MOBI_KWID');
  });

  it('valor fora do padrão não sugere modelo', () => {
    const t = triarCasoLegado({ assinaturas: [ativa], cobrancas: [paga('2026-09-07', 80_000), pendente('2026-09-28', 80_000)], hoje: HOJE });
    expect(t.valorParcelaPadrao).toBe(80_000);
    expect(t.modeloSugerido).toBeNull();
  });

  it('sem cobrança nenhuma mas assinatura ativa: usa o valor da assinatura', () => {
    const t = triarCasoLegado({ assinaturas: [ativa], cobrancas: [], hoje: HOJE });
    expect(t.situacao).toBe('SEM_VENCIDA');
    expect(t.valorParcelaPadrao).toBe(PARCELA_LEGADA_HB20);
  });
});

describe('decomporParcelaLegada', () => {
  it('997 = 942 + 50 + 5 (padrão)', () => {
    expect(decomporParcelaLegada(PARCELA_LEGADA_HB20)).toEqual({ parcelamento: 94_200, seguro: 5_000, taxaMensagens: 500, padrao: true });
  });
  it('697 = 642 + 50 + 5 (padrão)', () => {
    expect(decomporParcelaLegada(PARCELA_LEGADA_MOBI_KWID)).toEqual({ parcelamento: 64_200, seguro: 5_000, taxaMensagens: 500, padrao: true });
  });
  it('fora do padrão decompõe do mesmo jeito, mas marca como proposta', () => {
    expect(decomporParcelaLegada(80_000)).toEqual({ parcelamento: 74_500, seguro: 5_000, taxaMensagens: 500, padrao: false });
  });
  it('valor pequeno demais não é decomposto', () => {
    expect(decomporParcelaLegada(5_000)).toEqual({ parcelamento: 5_000, seguro: 0, taxaMensagens: 0, padrao: false });
  });
});
