import { describe, it, expect } from 'vitest';
import { classificarContrato, contarPorTipo, fatiaDaCarteira } from './tipo-contrato';

// Decisão Luís 29/10/2026: KPIs da Carteira por CONTA e por TIPO — produção tem
// 62 contratos de veículo + 4 Reembolsos Parcelados (RPs do legado, "<numero>-RPn").
describe('classificarContrato — tipo derivado do ContratoCredito (doc 02 §5.2)', () => {
  it('contrato com ativo VEICULO é veículo (qualquer modalidade, qualquer variante)', () => {
    expect(classificarContrato({ numero: '202511002', ativo: { tipo: 'VEICULO' } })).toBe('veiculo');
    expect(classificarContrato({ numero: '2026100006', ativo: { tipo: 'veiculo' } })).toBe('veiculo');
    // legado com snapshot sem reembolsoDe continua veículo
    expect(classificarContrato({ numero: '2025090001', ativo: { tipo: 'VEICULO' }, snapshotJson: { legado: { casoId: 'x' } } })).toBe('veiculo');
  });

  it('RP do legado: snapshotJson.legado.reembolsoDe OU sufixo -RPn', () => {
    expect(classificarContrato({ numero: '202511002-RP1', ativo: null, snapshotJson: { legado: { reembolsoDe: '202511002', rotulo: 'IPVA' } } })).toBe('reembolso');
    expect(classificarContrato({ numero: '202511002-RP2', ativo: null })).toBe('reembolso');
    expect(classificarContrato({ numero: '202511002-rp3', ativo: null })).toBe('reembolso');
  });

  it('RP nativo: a marca é a aprovação tipoOperacao reembolso_parcelado (informada pelo service)', () => {
    expect(classificarContrato({ numero: '2026100020', ativo: null, aprovadoComoReembolso: true })).toBe('reembolso');
  });

  it('crédito avulso: sem ativo e sem marca de reembolso; ou com ativo sintético OUTRO (forma antiga)', () => {
    expect(classificarContrato({ numero: '2026100021', ativo: null })).toBe('credito');
    expect(classificarContrato({ numero: '2026080003', ativo: { tipo: 'OUTRO' } })).toBe('credito');
    expect(classificarContrato({ numero: '2026080003', ativo: { tipo: 'OUTRO' }, snapshotJson: { documento: 'termo' } })).toBe('credito');
  });

  it('Termo de novação tem precedência sobre tudo (não tem ativo nem marca de RP)', () => {
    expect(classificarContrato({ numero: '2026100030', ativo: null, termoDeNovacao: true })).toBe('termo_novacao');
  });

  it('snapshotJson malformado não quebra a classificação', () => {
    expect(classificarContrato({ numero: '1', ativo: null, snapshotJson: 'texto' })).toBe('credito');
    expect(classificarContrato({ numero: '1', ativo: null, snapshotJson: { legado: 'x' } })).toBe('credito');
    expect(classificarContrato({ numero: '1', ativo: null, snapshotJson: { legado: { reembolsoDe: '' } } })).toBe('credito');
  });

  it('contarPorTipo zera os tipos ausentes', () => {
    expect(contarPorTipo(['veiculo', 'veiculo', 'reembolso'])).toEqual({ veiculo: 2, reembolso: 1, credito: 0, termo_novacao: 0 });
    expect(contarPorTipo([])).toEqual({ veiculo: 0, reembolso: 0, credito: 0, termo_novacao: 0 });
  });
});

describe('fatiaDaCarteira — fatias da carteira sob gestão', () => {
  it('item de origem ACORDO é cota de acordo, seja de que contrato for', () => {
    expect(fatiaDaCarteira('veiculo', 'ACORDO')).toBe('acordos');
    expect(fatiaDaCarteira('reembolso', 'acordo')).toBe('acordos');
  });
  it('Termo de novação é dívida renegociada (fatia dos acordos)', () => {
    expect(fatiaDaCarteira('termo_novacao', 'VENDA')).toBe('acordos');
  });
  it('reembolso e crédito avulso ficam juntos; veículo é o resto', () => {
    expect(fatiaDaCarteira('reembolso', 'VENDA')).toBe('reembolsos');
    expect(fatiaDaCarteira('credito', 'VENDA')).toBe('reembolsos');
    expect(fatiaDaCarteira('veiculo', 'VENDA')).toBe('veiculo');
  });
});
