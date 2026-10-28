import { describe, expect, it } from 'vitest';
import {
  extrairRendaMediaRelatorio,
  identidadeConfereCamada1,
  normalizarNome,
  sugerirProcessosRelevantes,
  valorBrasileiroParaCentavos,
} from './analise-preenchimento';

// Preenchimento da análise pelo sistema (decisão Luís 28/10/2026, doc 02 §14).

describe('identidadeConfereCamada1', () => {
  it('nome oficial em caixa alta e sem acento confere com o cadastrado (caso Jeferson)', () => {
    const r = identidadeConfereCamada1({
      nomeCadastrado: 'Jeferson Pereira Ribeiro',
      nomeOficial: 'JEFERSON PEREIRA RIBEIRO',
      cpfRegular: true,
      indicacaoObito: false,
    });
    expect(r.confere).toBe(true);
  });

  it('acentos e espaços duplicados não atrapalham', () => {
    expect(normalizarNome('  JOÃO  José da SILVA ')).toBe('joao jose da silva');
    expect(identidadeConfereCamada1({ nomeCadastrado: 'João José da Silva', nomeOficial: 'JOAO JOSE DA SILVA', cpfRegular: true, indicacaoObito: false }).confere).toBe(true);
  });

  it('nome diferente, CPF irregular ou óbito deixam a validação com o analista', () => {
    expect(identidadeConfereCamada1({ nomeCadastrado: 'Jeferson P. Ribeiro', nomeOficial: 'JEFERSON PEREIRA RIBEIRO', cpfRegular: true, indicacaoObito: false }).confere).toBe(false);
    expect(identidadeConfereCamada1({ nomeCadastrado: 'Jeferson Pereira Ribeiro', nomeOficial: 'JEFERSON PEREIRA RIBEIRO', cpfRegular: false, indicacaoObito: false }).motivo).toMatch(/CPF/);
    expect(identidadeConfereCamada1({ nomeCadastrado: 'Jeferson Pereira Ribeiro', nomeOficial: 'JEFERSON PEREIRA RIBEIRO', cpfRegular: true, indicacaoObito: true }).motivo).toMatch(/óbito/);
    expect(identidadeConfereCamada1({ nomeCadastrado: 'Jeferson Pereira Ribeiro', nomeOficial: null, cpfRegular: true, indicacaoObito: false }).confere).toBe(false);
  });
});

describe('valorBrasileiroParaCentavos', () => {
  it('lê os formatos que o relatório usa', () => {
    expect(valorBrasileiroParaCentavos('10.548,15', false)).toBe(1_054_815);
    expect(valorBrasileiroParaCentavos('10548,15', false)).toBe(1_054_815);
    expect(valorBrasileiroParaCentavos('10.548', false)).toBe(1_054_800);
    expect(valorBrasileiroParaCentavos('9789', false)).toBe(978_900);
    expect(valorBrasileiroParaCentavos('10,5', true)).toBe(1_050_000);
    expect(valorBrasileiroParaCentavos('10.5', true)).toBe(1_050_000);
    expect(valorBrasileiroParaCentavos('10', true)).toBe(1_000_000);
    expect(valorBrasileiroParaCentavos('abc', false)).toBeNull();
  });
});

describe('extrairRendaMediaRelatorio', () => {
  const RELATORIO = `JEFERSON PEREIRA RIBEIRO | Análise cadastral

Cadastro: 39 anos, Cariacica/ES, CPF regular e CNH válida.

Renda bruta Uber: jul R$ 7.812,40 | ago R$ 8.102,15 | set R$ 7.590,30. Média 3M: R$ 7.834,95/mês.

Oferta e comprometimento: entrada de R$ 1.999,00 e 156 parcelas semanais de R$ 999,98 (≈ R$ 4.345,11/mês). A parcela mensal equivalente compromete 55,5% da renda bruta média apurada.

Resumo objetivo: R$ 7,8 mil/mês | 1 apontamento | sem protestos.`;

  it('lê a Média 3M exata do relatório', () => {
    const r = extrairRendaMediaRelatorio(RELATORIO);
    expect(r).not.toBeNull();
    expect(r?.centavos).toBe(783_495);
    expect(r?.aproximado).toBe(false);
    expect(r?.trecho).toBe('Média 3M: R$ 7.834,95');
  });

  it('aceita a forma compacta do WhatsApp (R$ 10,5 mil) e sinaliza como aproximada', () => {
    const r = extrairRendaMediaRelatorio('Renda bruta Uber + 99: abr R$ 10,5 mil | mai R$ 9,8 mil | jun R$ 10,2 mil. Média 3M: R$ 10,2 mil/mês.');
    expect(r?.centavos).toBe(1_020_000);
    expect(r?.aproximado).toBe(true);
  });

  it('tolera parêntese antes dos dois-pontos, caixa e "≈"', () => {
    expect(extrairRendaMediaRelatorio('média 3m (meses completos): ≈ R$ 6.100,00/mês')?.centavos).toBe(610_000);
    expect(extrairRendaMediaRelatorio('Média 3 meses: R$ 6100/mês')?.centavos).toBe(610_000);
  });

  it('sem média legível (renda não apurada, texto vazio, valor absurdo) devolve null', () => {
    expect(extrairRendaMediaRelatorio('Renda bruta: não identificada. Média 3M: não calculável — renda não apurada.')).toBeNull();
    expect(extrairRendaMediaRelatorio('')).toBeNull();
    expect(extrairRendaMediaRelatorio(null)).toBeNull();
    expect(extrairRendaMediaRelatorio('Média 3M: R$ 12/mês')).toBeNull();
    expect(extrairRendaMediaRelatorio('Média 3M: R$ 900.000,00/mês')).toBeNull();
  });
});

describe('sugerirProcessosRelevantes', () => {
  const CPF = '12251049711';
  const bruto = (lawsuits: Record<string, unknown>[]) => ({ result: { Processes: { TotalLawsuits: lawsuits.length, Lawsuits: lawsuits } } });

  it('busca e apreensão ativa com o cliente no polo passivo → sugere', () => {
    const r = sugerirProcessosRelevantes(
      bruto([{ Number: '0001234-56.2025.8.08.0012', MainSubject: 'Busca e Apreensão em Alienação Fiduciária', Status: 'EM ANDAMENTO', Parties: [{ Doc: CPF, Polarity: 'PASSIVE' }, { Doc: '11222333000144', Polarity: 'ACTIVE' }] }]),
      CPF,
    );
    expect(r.sugerir).toBe(true);
    expect(r.processos[0].poloPassivo).toBe(true);
    expect(r.motivo).toMatch(/polo passivo/);
  });

  it('cliente no polo ATIVO (ele cobra alguém) não sugere', () => {
    const r = sugerirProcessosRelevantes(bruto([{ MainSubject: 'Cobrança', Status: 'ATIVO', Parties: [{ Doc: CPF, Polarity: 'ACTIVE' }] }]), CPF);
    expect(r.sugerir).toBe(false);
  });

  it('processo arquivado ou de outra natureza (trabalhista, família) não sugere', () => {
    expect(sugerirProcessosRelevantes(bruto([{ MainSubject: 'Execução de Título Extrajudicial', Status: 'ARQUIVADO' }]), CPF).sugerir).toBe(false);
    expect(sugerirProcessosRelevantes(bruto([{ MainSubject: 'Reclamação Trabalhista', Status: 'ATIVO' }, { MainSubject: 'Divórcio', Status: 'ATIVO' }]), CPF).sugerir).toBe(false);
  });

  it('polo desconhecido com assunto financeiro ativo ainda sugere (o analista decide)', () => {
    const r = sugerirProcessosRelevantes(bruto([{ MainSubject: 'Execução Fiscal', Status: 'ATIVO' }]), CPF);
    expect(r.sugerir).toBe(true);
    expect(r.processos[0].poloPassivo).toBeNull();
  });

  it('payload sem lista ou vazio não sugere', () => {
    expect(sugerirProcessosRelevantes(null, CPF).sugerir).toBe(false);
    expect(sugerirProcessosRelevantes({ result: { Processes: { TotalLawsuits: 0, Lawsuits: [] } } }, CPF).sugerir).toBe(false);
  });
});
