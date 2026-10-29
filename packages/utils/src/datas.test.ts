import { describe, it, expect } from 'vitest';
import {
  diaBrasil, dataCalendarioUTC, somarDiasISO, partesBrasil, diaSemanaISO, isoParaBR,
  formatarDiaBR, formatarInstanteBR, inicioDiaUTC, diasAtrasoCalendario, dataHojeBrasil, diaDeColunaMista, inicioSemanaISO,
} from './datas';

describe('inicioSemanaISO — semana começa na segunda (recebido na semana, 29/10/2026)', () => {
  it('quinta 29/10/2026 → segunda 26/10/2026', () => {
    expect(inicioSemanaISO('2026-10-29')).toBe('2026-10-26');
  });
  it('segunda é o próprio dia; sábado e domingo fecham a mesma semana', () => {
    expect(inicioSemanaISO('2026-10-26')).toBe('2026-10-26');
    expect(inicioSemanaISO('2026-10-31')).toBe('2026-10-26'); // sábado
    expect(inicioSemanaISO('2026-11-01')).toBe('2026-10-26'); // domingo
  });
  it('atravessa o mês e o ano', () => {
    expect(inicioSemanaISO('2026-11-03')).toBe('2026-11-02');
    expect(inicioSemanaISO('2027-01-01')).toBe('2026-12-28'); // sexta → segunda do ano anterior
  });
});

describe('datas — fuso do negócio (Regra 15)', () => {
  it('diaBrasil: instante entre 21h e 24h de Brasília ainda é o dia de Brasília, não o de UTC', () => {
    // 16/10/2026 23:30 em Brasília = 17/10/2026 02:30Z (caso das órfãs da migração)
    const instante = new Date('2026-10-17T02:30:00.000Z');
    expect(instante.toISOString().slice(0, 10)).toBe('2026-10-17'); // o que o código antigo fazia
    expect(diaBrasil(instante)).toBe('2026-10-16');
  });

  it('dataCalendarioUTC: coluna de data em UTC-midnight (cronograma) e em 03:00Z (legado) dão o mesmo dia', () => {
    expect(dataCalendarioUTC(new Date('2026-10-20T00:00:00.000Z'))).toBe('2026-10-20');
    expect(dataCalendarioUTC(new Date('2026-10-20T03:00:00.000Z'))).toBe('2026-10-20');
    // diaBrasil NÃO serve para coluna de data: meia-noite UTC é 21h do dia anterior em Brasília
    expect(diaBrasil(new Date('2026-10-20T00:00:00.000Z'))).toBe('2026-10-19');
  });

  it('diaDeColunaMista: meia-noite UTC é dia-calendário; qualquer outro horário é instante no fuso', () => {
    expect(diaDeColunaMista(new Date('2026-10-20T00:00:00.000Z'))).toBe('2026-10-20'); // dia escolhido na tela
    expect(diaDeColunaMista(new Date('2026-10-21T01:30:00.000Z'))).toBe('2026-10-20'); // now() às 22:30 de Brasília
  });

  it('somarDiasISO soma no calendário, cruzando mês e ano', () => {
    expect(somarDiasISO('2026-10-30', 5)).toBe('2026-11-04');
    expect(somarDiasISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDiasISO('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('partesBrasil: hora e dia da semana no fuso de Brasília', () => {
    // 20/10/2026 é terça; 14:30Z = 11:30 em Brasília
    const p = partesBrasil(new Date('2026-10-20T14:30:00.000Z'));
    expect(p).toEqual({ dia: '2026-10-20', hora: 11, minuto: 30, diaSemana: 2 });
    // 02:00Z de quarta = 23:00 de terça em Brasília
    expect(partesBrasil(new Date('2026-10-21T02:00:00.000Z'))).toMatchObject({ dia: '2026-10-20', hora: 23, diaSemana: 2 });
  });

  it('diaSemanaISO e formatos BR', () => {
    expect(diaSemanaISO('2026-10-19')).toBe(1); // segunda
    expect(isoParaBR('2026-10-05')).toBe('05/10/2026');
    expect(formatarDiaBR(new Date('2026-10-05T00:00:00.000Z'))).toBe('05/10/2026');
    expect(formatarInstanteBR(new Date('2026-10-06T01:00:00.000Z'))).toBe('05/10/2026');
    expect(inicioDiaUTC('2026-10-05').toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('dataHojeBrasil tem formato ISO de dia e bate com diaBrasil(agora)', () => {
    expect(dataHojeBrasil()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataHojeBrasil()).toBe(diaBrasil(new Date()));
  });

  it('diasAtrasoCalendario conta dias de calendário a partir da referência', () => {
    const venc = new Date('2026-10-01T00:00:00.000Z');
    expect(diasAtrasoCalendario(venc, new Date('2026-10-04T00:00:00.000Z'))).toBe(3);
    expect(diasAtrasoCalendario(venc, new Date('2026-09-30T00:00:00.000Z'))).toBe(0);
  });
});
