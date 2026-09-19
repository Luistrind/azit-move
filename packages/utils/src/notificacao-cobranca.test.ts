import { describe, it, expect } from 'vitest';
import {
  ajustarParaJanela,
  avaliarCasoCobranca,
  dentroJanelaEnvio,
  ehDiaUtilBrasil,
  vencimentosDistintos,
  type EstadoCasoCobranca,
} from './notificacao-cobranca';

// Horário de São Paulo (UTC−3) para legibilidade dos cenários.
const sp = (isoLocal: string) => new Date(`${isoLocal}:00.000-03:00`);

const caso = (over: Partial<EstadoCasoCobranca>): EstadoCasoCobranca => ({
  vencimentosEmAtraso: ['2026-09-20'],
  diasAtraso: 1,
  enviadas: {},
  veiculoRetomadoEm: null,
  noJuridico: false,
  agora: sp('2026-09-21T10:00'), // segunda-feira
  ...over,
});

describe('calendário de envio (cláusula 1.1: dias úteis)', () => {
  it('fim de semana e feriados nacionais não são dias úteis', () => {
    expect(ehDiaUtilBrasil('2026-09-21')).toBe(true); // segunda
    expect(ehDiaUtilBrasil('2026-09-19')).toBe(false); // sábado
    expect(ehDiaUtilBrasil('2026-09-07')).toBe(false); // Independência
    expect(ehDiaUtilBrasil('2026-04-03')).toBe(false); // Sexta-feira Santa (Páscoa 05/04)
    expect(ehDiaUtilBrasil('2026-11-20')).toBe(false); // Consciência Negra
  });

  it('janela 9h–17h em dia útil', () => {
    expect(dentroJanelaEnvio(sp('2026-09-21T09:00'))).toBe(true);
    expect(dentroJanelaEnvio(sp('2026-09-21T16:59'))).toBe(true);
    expect(dentroJanelaEnvio(sp('2026-09-21T17:00'))).toBe(false);
    expect(dentroJanelaEnvio(sp('2026-09-21T08:59'))).toBe(false);
    expect(dentroJanelaEnvio(sp('2026-09-19T10:00'))).toBe(false);
  });

  it('fora da janela, ajusta para a próxima abertura', () => {
    expect(ajustarParaJanela(sp('2026-09-21T07:30'))).toEqual(sp('2026-09-21T09:00'));
    expect(ajustarParaJanela(sp('2026-09-25T17:30'))).toEqual(sp('2026-09-28T09:00')); // sexta → segunda
    expect(ajustarParaJanela(sp('2026-09-19T11:00'))).toEqual(sp('2026-09-21T09:00')); // sábado
    expect(ajustarParaJanela(sp('2026-09-04T18:00'))).toEqual(sp('2026-09-08T09:00')); // pula o 07/09
  });
});

describe('avaliarCasoCobranca — POP-COB-001', () => {
  it('1ª notificação sai no D1, dentro da janela', () => {
    const a = avaliarCasoCobranca(caso({}));
    expect(a.enviarAgora).toBe(1);
    expect(a.fase).toBe('ordinaria');
  });

  it('gatilho no fim de semana espera a segunda às 9h', () => {
    const a = avaliarCasoCobranca(caso({ agora: sp('2026-09-19T10:00') }));
    expect(a.enviarAgora).toBeNull();
    expect(a.proxima?.etapa).toBe(1);
    expect(a.proxima?.prevista).toEqual(sp('2026-09-21T09:00'));
  });

  it('2ª só 72h após a 1ª', () => {
    const e1 = sp('2026-09-21T10:00');
    const antes = avaliarCasoCobranca(caso({ enviadas: { 1: e1 }, agora: sp('2026-09-24T09:30') }));
    expect(antes.enviarAgora).toBeNull();
    expect(antes.proxima).toMatchObject({ etapa: 2, prevista: sp('2026-09-24T10:00') });
    const depois = avaliarCasoCobranca(caso({ enviadas: { 1: e1 }, agora: sp('2026-09-24T10:05') }));
    expect(depois.enviarAgora).toBe(2);
  });

  it('72h que caem no sábado viram segunda às 9h', () => {
    const a = avaliarCasoCobranca(caso({ enviadas: { 1: sp('2026-09-23T16:30') }, agora: sp('2026-09-26T16:30') }));
    expect(a.enviarAgora).toBeNull();
    expect(a.proxima?.prevista).toEqual(sp('2026-09-28T09:00'));
  });

  it('3ª exige duas parcelas vencidas ao mesmo tempo', () => {
    const enviadas = { 1: sp('2026-09-21T10:00'), 2: sp('2026-09-24T10:00') };
    const uma = avaliarCasoCobranca(caso({ enviadas, agora: sp('2026-09-25T10:00') }));
    expect(uma.enviarAgora).toBeNull();
    expect(uma.proxima).toMatchObject({ etapa: 3, prevista: null });
    const duas = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: ['2026-09-20', '2026-09-27'], diasAtraso: 8, agora: sp('2026-09-28T10:00') }));
    expect(duas.enviarAgora).toBe(3);
  });

  it('no máximo uma notificação por dia (caso que já nasce com 2 parcelas)', () => {
    const a = avaliarCasoCobranca(caso({
      vencimentosEmAtraso: ['2026-09-13', '2026-09-20'],
      enviadas: { 1: sp('2026-09-18T10:00'), 2: sp('2026-09-21T09:05') },
      agora: sp('2026-09-21T10:00'),
    }));
    expect(a.enviarAgora).toBeNull();
    expect(a.proxima).toMatchObject({ etapa: 3, prevista: sp('2026-09-22T09:00') });
  });

  it('4ª 72h após a 3ª; suspensa se o atraso cair para 1 parcela', () => {
    const enviadas = { 1: sp('2026-09-21T10:00'), 2: sp('2026-09-24T10:00'), 3: sp('2026-09-28T10:00') };
    const duas = ['2026-09-20', '2026-09-27'];
    const cedo = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: duas, agora: sp('2026-09-30T10:00') }));
    expect(cedo.enviarAgora).toBeNull();
    expect(cedo.monitorarVeiculo).toBe(true);
    expect(cedo.fase).toBe('escalonamento');
    const hora = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: duas, agora: sp('2026-10-01T10:00') }));
    expect(hora.enviarAgora).toBe(4);
    const pagouUma = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: ['2026-09-27'], agora: sp('2026-10-01T10:00') }));
    expect(pagouUma.enviarAgora).toBeNull();
    expect(pagouUma.proxima).toMatchObject({ etapa: 4, prevista: null });
  });

  it('bloqueio liberado 24h após a 4ª (Regra 6)', () => {
    const e4 = sp('2026-10-01T10:00');
    const enviadas = { 1: sp('2026-09-21T10:00'), 2: sp('2026-09-24T10:00'), 3: sp('2026-09-28T10:00'), 4: e4 };
    const antes = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: ['2026-09-20', '2026-09-27'], agora: sp('2026-10-02T09:59') }));
    expect(antes.bloqueioLiberado).toBe(false);
    expect(antes.fase).toBe('pre_bloqueio');
    expect(antes.bloqueioLiberadoEm).toEqual(sp('2026-10-02T10:00'));
    const depois = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: ['2026-09-20', '2026-09-27'], agora: sp('2026-10-02T10:00') }));
    expect(depois.bloqueioLiberado).toBe(true);
    expect(depois.fase).toBe('bloqueio_liberado');
    expect(depois.proxima).toMatchObject({ etapa: 5, prevista: null });
  });

  it('5ª sai ao registrar a retomada', () => {
    const enviadas = { 1: sp('2026-09-21T10:00'), 2: sp('2026-09-24T10:00'), 3: sp('2026-09-28T10:00'), 4: sp('2026-10-01T10:00') };
    const a = avaliarCasoCobranca(caso({ enviadas, vencimentosEmAtraso: ['2026-09-20', '2026-09-27'], veiculoRetomadoEm: sp('2026-10-05T08:00'), agora: sp('2026-10-05T10:00') }));
    expect(a.enviarAgora).toBe(5);
    expect(a.fase).toBe('pos_retomada');
  });

  it('caso no jurídico sai do automático; 6ª nunca é automática', () => {
    const j = avaliarCasoCobranca(caso({ noJuridico: true }));
    expect(j.enviarAgora).toBeNull();
    expect(j.fase).toBe('juridico');
    const longo = avaliarCasoCobranca(caso({ diasAtraso: 31, enviadas: { 1: sp('2026-08-21T10:00'), 2: sp('2026-08-24T10:00'), 3: sp('2026-08-28T10:00'), 4: sp('2026-09-01T10:00'), 5: sp('2026-09-03T10:00') } }));
    expect(longo.rescisaoSinalizada).toBe(true);
    expect(longo.enviarAgora).toBeNull();
  });

  it('4 parcelas vencidas sinalizam rescisão', () => {
    const a = avaliarCasoCobranca(caso({ vencimentosEmAtraso: ['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20'], diasAtraso: 22 }));
    expect(a.rescisaoSinalizada).toBe(true);
  });
});

describe('vencimentosDistintos', () => {
  it('linhas do mesmo vencimento (veículo + proteção) contam como uma parcela', () => {
    const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
    expect(vencimentosDistintos([d('2026-09-20'), d('2026-09-13'), d('2026-09-20')])).toEqual(['2026-09-13', '2026-09-20']);
  });
});
