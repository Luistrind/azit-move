import { describe, expect, it } from 'vitest';
import {
  avaliarAnaliseCadastro,
  parcelaMensalEquivalente,
  AnaliseInput,
  ParticipanteAnaliseInput,
} from './analise-cadastro';

const PARAMS = {
  comprometimentoAlcada: 0.4,
  scoreQuodMinimo: 600,
  restritivoNaoFinanceiroMax: 50_000, // R$ 500
  fatorSemanal: 4.345,
  fatorQuinzenal: 2.17,
};

const consultaOk = { registrada: true, falhou: false };

function comprador(sobrescreve: Partial<ParticipanteAnaliseInput> = {}): ParticipanteAnaliseInput {
  return {
    titularId: 't1',
    papel: 'COMPRADOR_PRINCIPAL',
    identidadeValidada: true,
    cnhValida: true,
    documentoAlternativo: false,
    autorizacaoRegistrada: true,
    atividadeComprovada: true,
    rendaApurada: 600_000, // R$ 6.000
    rendaParcialmenteComprovada: false,
    scoreQuod: 630,
    consultaCamada1: consultaOk,
    consultaScore: consultaOk,
    consultaRestritivos: consultaOk,
    restritivosFinanceiros: 0,
    restritivosNaoFinanceiros: 0,
    protestoChequeExecucao: false,
    processosRelevantes: false,
    alertaFraudeAtivo: false,
    ...sobrescreve,
  };
}

function entrada(sobrescreve: Partial<AnaliseInput> = {}): AnaliseInput {
  return {
    participantes: [comprador()],
    condutorPrincipalTitularId: 't1',
    valorParcela: 48_000, // R$ 480 semanal -> PME ~ R$ 2.085,60 -> 34,76% de 6.000
    frequencia: 'semanal',
    pendenciasAbertas: 0,
    parametros: PARAMS,
    ...sobrescreve,
  };
}

describe('parcelaMensalEquivalente (RF-09)', () => {
  it('semanal x4,345 / quinzenal x2,17 / mensal x1', () => {
    expect(parcelaMensalEquivalente(94_200, 'semanal', PARAMS)).toBe(409_299); // R$ 4.092,99
    expect(parcelaMensalEquivalente(94_200, 'quinzenal', PARAMS)).toBe(204_414);
    expect(parcelaMensalEquivalente(94_200, 'mensal', PARAMS)).toBe(94_200);
  });
});

describe('avaliarAnaliseCadastro — cenários do Contexto §17', () => {
  it('cenário 1: motorista de app com caso limpo → alçada do analista', () => {
    const r = avaliarAnaliseCadastro(entrada());
    expect(r.aprovacaoDiretaPermitida).toBe(true);
    expect(r.alcadaMinima).toBe('ANALISTA');
    expect(r.criterios).toHaveLength(0);
  });

  it('cenário 2: restritivo de telefonia R$ 487 → permanece na alçada', () => {
    const r = avaliarAnaliseCadastro(entrada({ participantes: [comprador({ restritivosNaoFinanceiros: 48_700 })] }));
    expect(r.aprovacaoDiretaPermitida).toBe(true);
  });

  it('cenário 3: Score Quod 580 → COCAD (COC-02), sem reprovação automática', () => {
    const r = avaliarAnaliseCadastro(entrada({ participantes: [comprador({ scoreQuod: 580 })] }));
    expect(r.aprovacaoDiretaPermitida).toBe(false);
    expect(r.alcadaMinima).toBe('COCAD');
    expect(r.codigosCocad).toContain('COC-02');
  });

  it('cenário 4: comprometimento 45% → COCAD (COC-01) — exemplo do Contexto §15.3', () => {
    // parcela semanal 942 -> PME 4.092,99; renda 9.135 -> 44,8%
    const r = avaliarAnaliseCadastro(
      entrada({ valorParcela: 94_200, participantes: [comprador({ rendaApurada: 913_500 })] }),
    );
    expect(r.comprometimento).toBeCloseTo(0.448, 3);
    expect(r.codigosCocad).toContain('COC-01');
    expect(r.aprovacaoDiretaPermitida).toBe(false);
  });

  it('cenário 6: dois compradores — restritivo do 2º afeta a proposta inteira', () => {
    const r = avaliarAnaliseCadastro(
      entrada({
        participantes: [
          comprador(),
          comprador({ titularId: 't2', papel: 'COMPRADOR_SECUNDARIO', cnhValida: false, documentoAlternativo: true, restritivosFinanceiros: 10_000 }),
        ],
      }),
    );
    expect(r.aprovacaoDiretaPermitida).toBe(false);
    expect(r.codigosCocad).toContain('COC-03');
  });

  it('cenário 8: fraude relevante bloqueia formalização mesmo com o resto conforme', () => {
    const r = avaliarAnaliseCadastro(entrada({ participantes: [comprador({ alertaFraudeAtivo: true })] }));
    expect(r.bloqueiaFormalizacao).toBe(true);
    expect(r.codigosCocad).toContain('COC-07');
  });

  it('cenário 9 (feedback §3): consulta indisponível → alçada mínima COCAD, fluxo não trava', () => {
    const r = avaliarAnaliseCadastro(
      entrada({ participantes: [comprador({ consultaRestritivos: { registrada: false, falhou: true } })] }),
    );
    expect(r.aprovacaoDiretaPermitida).toBe(false);
    expect(r.alcadaMinima).toBe('COCAD');
    expect(r.codigosCocad).toContain('COC-11');
    expect(r.bloqueiaFormalizacao).toBe(false); // COCAD pode decidir e liberar
  });

  it('feedback §1: nenhum comprador com CNH → bloqueio de formalização', () => {
    const r = avaliarAnaliseCadastro(
      entrada({ participantes: [comprador({ cnhValida: false, documentoAlternativo: true })], condutorPrincipalTitularId: 't1' }),
    );
    expect(r.bloqueiaFormalizacao).toBe(true);
  });

  it('feedback §1: dois compradores, um com CNH (condutor) e outro com RG → segue', () => {
    const r = avaliarAnaliseCadastro(
      entrada({
        participantes: [
          comprador(),
          comprador({ titularId: 't2', papel: 'COMPRADOR_SECUNDARIO', cnhValida: false, documentoAlternativo: true }),
        ],
      }),
    );
    expect(r.bloqueiaFormalizacao).toBe(false);
  });

  it('garantidor presente sempre sobe ao COCAD (COC-10) e renda dele não soma', () => {
    const r = avaliarAnaliseCadastro(
      entrada({
        valorParcela: 94_200,
        participantes: [
          comprador({ rendaApurada: 913_500 }),
          comprador({ titularId: 'tg', papel: 'GARANTIDOR', rendaApurada: 2_000_000, cnhValida: false, documentoAlternativo: true }),
        ],
      }),
    );
    expect(r.codigosCocad).toContain('COC-10');
    // comprometimento calculado só com a renda do comprador (44,8%), não 14%
    expect(r.comprometimento).toBeCloseTo(0.448, 3);
  });

  it('renda apurada ausente → complemento COM-06 (não COCAD)', () => {
    const r = avaliarAnaliseCadastro(entrada({ participantes: [comprador({ rendaApurada: null })] }));
    expect(r.exigeComplemento).toBe(true);
    expect(r.codigosComplemento).toContain('COM-06');
    expect(r.comprometimento).toBeNull();
  });
});
