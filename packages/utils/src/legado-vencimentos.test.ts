import { describe, expect, it } from 'vitest';
import { alinharVencimentosLegado, avancarPeriodoISO } from './legado-vencimentos';
import { nomeDiaSemanaISO } from './datas';

// Doc 02 §26.15 item 5 (decisão Luís 20/10/2026): parcela, fatura e recebível
// vencem no MESMO dia — o da cobrança real; sem cobrança, a cadência segue a
// última data real. Casos de produção: Carmo (contrato segunda, cobrança
// sexta, acordo em andamento) e Gerci (1 dia de diferença).

const linha = (n: number, esperadoEm: string, cobradoEm: string | null = null) => ({ chave: `parcela:${n}`, esperadoEm, cobradoEm });

describe('avancarPeriodoISO — o passo do cronograma em dia-calendário', () => {
  it('semanal +7, quinzenal +14', () => {
    expect(avancarPeriodoISO('2026-10-15', 1, 'semanal')).toBe('2026-10-22');
    expect(avancarPeriodoISO('2026-10-15', 3, 'semanal')).toBe('2026-11-05');
    expect(avancarPeriodoISO('2026-10-15', 1, 'quinzenal')).toBe('2026-10-29');
  });
  it('mensal anda por mês do calendário com clamp no fim do mês', () => {
    expect(avancarPeriodoISO('2026-01-15', 1, 'mensal')).toBe('2026-02-15');
    expect(avancarPeriodoISO('2026-01-31', 1, 'mensal')).toBe('2026-02-28');
    expect(avancarPeriodoISO('2026-01-31', 2, 'mensal')).toBe('2026-03-31');
  });
});

describe('alinharVencimentosLegado', () => {
  it('Carmo: contrato na segunda, cobrança na SEXTA — tudo vence na sexta, inclusive as futuras e as cobertas pelo acordo sem cobrança', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2026-03-02', '2026-03-06'), // paga, cobrança sexta
      linha(2, '2026-03-09', '2026-03-13'), // paga
      linha(3, '2026-03-16', '2026-03-20'), // em_acordo, cobrança antiga (apagada na migração)
      linha(4, '2026-03-23'), // em_acordo sem cobrança própria
      linha(5, '2026-03-30'), // em_acordo sem cobrança própria
      linha(6, '2026-04-06', '2026-04-10'), // pendente, cobrança a vencer
      linha(7, '2026-04-13'), // futura
      linha(8, '2026-04-20'), // futura
    ], 'semanal');
    expect(r.map((v) => v.efetivo)).toEqual(['2026-03-06', '2026-03-13', '2026-03-20', '2026-03-27', '2026-04-03', '2026-04-10', '2026-04-17', '2026-04-24']);
    expect(r.map((v) => v.origem)).toEqual(['cobranca', 'cobranca', 'cobranca', 'cadencia', 'cadencia', 'cobranca', 'cadencia', 'cadencia']);
    expect(r.every((v) => v.diverge)).toBe(true);
    expect(r.every((v) => nomeDiaSemanaISO(v.efetivo) === 'sexta-feira')).toBe(true);
    expect(r.every((v) => nomeDiaSemanaISO(v.contrato) === 'segunda-feira')).toBe(true);
    expect(r[3]).toEqual({ chave: 'parcela:4', contrato: '2026-03-23', efetivo: '2026-03-27', origem: 'cadencia', diverge: true });
  });

  it('Gerci: 1 dia de diferença — a parcela segue a cobrança (terça), não o papel (segunda)', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2026-09-14', '2026-09-15'),
      linha(2, '2026-09-21', '2026-09-22'),
      linha(3, '2026-09-28'),
    ], 'semanal');
    expect(r.map((v) => v.efetivo)).toEqual(['2026-09-15', '2026-09-22', '2026-09-29']);
    expect(r.map((v) => v.diverge)).toEqual([true, true, true]);
  });

  it('sem divergência: cobrança no dia do contrato — nada muda', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2026-09-14', '2026-09-14'),
      linha(2, '2026-09-21', '2026-09-21'),
      linha(3, '2026-09-28'),
      linha(4, '2026-10-05'),
    ], 'semanal');
    expect(r.map((v) => v.efetivo)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(r.every((v) => !v.diverge)).toBe(true);
    expect(r.map((v) => v.origem)).toEqual(['cobranca', 'cobranca', 'cadencia', 'cadencia']);
  });

  it('sem cobrança nenhuma antes da primeira real: fica na data do contrato até a primeira cobrança ancorar', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2026-03-02'), // paga em dinheiro, sem cobrança
      linha(2, '2026-03-09'),
      linha(3, '2026-03-16', '2026-03-19'),
      linha(4, '2026-03-23'),
    ], 'semanal');
    expect(r.map((v) => `${v.origem}:${v.efetivo}`)).toEqual(['contrato:2026-03-02', 'cadencia:2026-03-09', 'cobranca:2026-03-19', 'cadencia:2026-03-26']);
  });

  it('cobrança no meio volta a ancorar: as seguintes seguem a ÚLTIMA data real', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2026-03-02', '2026-03-05'), // quinta
      linha(2, '2026-03-09'),
      linha(3, '2026-03-16', '2026-03-17'), // mudou para terça
      linha(4, '2026-03-23'),
    ], 'semanal');
    expect(r.map((v) => v.efetivo)).toEqual(['2026-03-05', '2026-03-12', '2026-03-17', '2026-03-24']);
  });

  it('mensal (Kaique): sem cobrança mantém o DIA DO MÊS da última cobrança real, mesmo depois de fevereiro', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2025-12-12', '2025-12-30'),
      linha(2, '2026-01-12'),
      linha(3, '2026-02-12'),
      linha(4, '2026-03-12'),
    ], 'mensal');
    expect(r.map((v) => v.efetivo)).toEqual(['2025-12-30', '2026-01-30', '2026-02-28', '2026-03-30']);
  });

  it('quinzenal: +14 a partir da última real', () => {
    const r = alinharVencimentosLegado([linha(1, '2026-03-02', '2026-03-04'), linha(2, '2026-03-16'), linha(3, '2026-03-30')], 'quinzenal');
    expect(r.map((v) => v.efetivo)).toEqual(['2026-03-04', '2026-03-18', '2026-04-01']);
  });

  it('adiadas entram por último e continuam a cadência depois da última parcela', () => {
    const r = alinharVencimentosLegado([
      linha(1, '2026-03-02', '2026-03-05'),
      linha(3, '2026-03-16', '2026-03-19'),
      linha(2, '2026-03-09'), // adiada: vai ao fim
    ], 'semanal');
    expect(r[2]).toMatchObject({ chave: 'parcela:2', efetivo: '2026-03-26', origem: 'cadencia' });
  });
});
