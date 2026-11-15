import type { ItemMotor } from '@azit/utils';
import type { ContaCarregada, FaturaDaConta } from './conta-fatura.service';

// Conta de teste do roteiro do Vicente (doc 02 §32.4): fatura de face
// R$ 1.049,00 = Compra Parcelada 699 + Proteção 50 (mesma parcela, nominal 749),
// Reembolso 120 e Acordo 180; multa 2%, atualização 1% a.m. Só para os specs.

export const HOJE = '2026-11-09';
export const AGORA = new Date('2026-11-09T15:00:00.000Z'); // 12h em Brasília

export function faturaFixture(id: string, numero: number, vencimento: string, extra: Partial<FaturaDaConta> = {}): FaturaDaConta {
  const taxa = { multaPct: 2, atualizacaoMesPct: 1 };
  const itensMotor: ItemMotor[] = [
    { id: `${id}:veiculo`, grupo: 'PRINCIPAL', valor: 69900, ...taxa },
    { id: `${id}:protecao`, grupo: 'PROTECAO', valor: 5000, ...taxa },
    { id: `${id}:reemb`, grupo: 'ACESSORIOS', valor: 12000, ...taxa },
    { id: `${id}:acordo`, grupo: 'ACESSORIOS', valor: 18000, ...taxa },
  ];
  const item = (sufixo: string, titulo: string, produto: string, parcela: string, contrato: string) => {
    const m = itensMotor.find((i) => i.id === `${id}:${sufixo}`)!;
    return { id: m.id, titulo, subtitulo: null, produto, grupo: m.grupo, valor: m.valor, parcelaId: `${id}:${parcela}`, contratoId: contrato };
  };
  const parcela = (sufixo: string, contratoId: string, valorNominal: number) => ({ id: `${id}:${sufixo}`, contratoId, valorNominal, vencimento, emAberto: true, valorPago: 0, valorEncargo: 0 });
  return {
    id,
    numero,
    tokenPublico: `tk-${id}`,
    status: 'FECHADA',
    vencimento,
    dataPagamento: null,
    valorPago: 0,
    itens: [
      item('veiculo', 'Compra Parcelada — Hyundai HB20S', 'compra_parcelada', 'pv', 'c-veiculo'),
      item('protecao', 'Proteção veicular', 'protecao_veicular', 'pv', 'c-veiculo'),
      item('reemb', 'Reembolso Parcelado — IPVA 2026', 'reembolso_parcelado', 'pr', 'c-reemb'),
      item('acordo', 'Acordo de pagamento', 'compra_parcelada', 'pa', 'c-veiculo'),
    ],
    parcelas: [parcela('pv', 'c-veiculo', 74900), parcela('pr', 'c-reemb', 12000), parcela('pa', 'c-veiculo', 18000)],
    pagamentos: [],
    motor: { id, vencimento, itens: itensMotor, pagamentos: [] },
    ...extra,
  };
}

export const F1 = () => faturaFixture('f1', 21, '2026-10-26');
export const F2 = () => faturaFixture('f2', 22, '2026-11-02');
export const F3 = () => faturaFixture('f3', 23, '2026-11-09');
export const F4 = () => faturaFixture('f4', 24, '2026-11-16');

export function contaFixture(faturas: FaturaDaConta[], extra: Partial<ContaCarregada> = {}): ContaCarregada {
  return {
    contaId: 'conta-1',
    titular: { id: 'tit-1', nome: 'Carlos Souza', cpfCnpj: '12345678901' },
    faturas,
    abertasModeloAntigo: [],
    parametros: { cascata: ['ENCARGOS', 'PROTECAO', 'ACESSORIOS', 'PRINCIPAL'], minimoParcialPct: 35, minimoParcialPiso: 20000, multaPadraoPct: 2, atualizacaoMesPadraoPct: 1, tetoIntencoesDia: 10 },
    ...extra,
  };
}
