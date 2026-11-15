import { aplicarPagamentoNaConta, reconstituirFatura } from '@azit/utils';
import { ContaFaturaService, type ContaCarregada, type FaturaDaConta, type SaldosAzitDaConta } from '../faturamento/conta-fatura.service';
import { contaFixture, F2 } from '../faturamento/conta.fixture-spec';

// Apoio dos specs de operações (acordo, novação, rescisão, quitação, sinistro)
// com fatura do modelo AZIT (doc 02 §32.12 item 12). Só para testes.

// Conta SEM fatura AZIT: os fluxos devem se comportar exatamente como antes.
export const semAzit = () => ({
  saldosEmAberto: jest.fn().mockResolvedValue({ faturaIds: new Set<string>(), porParcela: new Map(), semParcela: [] } satisfies SaldosAzitDaConta),
});
export const intencoesStub = () => ({ invalidarAtivasDaConta: jest.fn().mockResolvedValue(0) });

// O caso que quebrava (roteiro do Vicente): fatura de R$ 1.049 vencida em 02/11
// com R$ 540 pagos em 07/11 pela baixa da conta. Sobra só parte do veículo
// (531,73); proteção, reembolso e acordo já foram quitados — as parcelas deles
// (f2:pr, f2:pa) estão PAGAS e a do veículo (f2:pv, nominal 749,00) segue em aberto.
export function F2ComParcial(): FaturaDaConta {
  const f = F2();
  const { baixas } = aplicarPagamentoNaConta([reconstituirFatura(f.motor)], { data: '2026-11-07', valor: 54000 });
  const alocacoes = baixas[0].alocacoes;
  f.motor.pagamentos = [{ data: '2026-11-07', valor: 54000, alocacoes }];
  f.pagamentos = [{ id: 'pg-1', data: '2026-11-07', pagoEm: null, valor: 54000, valorExcedente: 0, origem: 'GATEWAY', gatewayPaymentId: 'pay_1', identificadorPix: null, intencaoId: 'int_1', alocacoes }];
  f.valorPago = 54000;
  f.parcelas = f.parcelas.map((p) => (p.id === 'f2:pv' ? { ...p, valorPago: 23350, valorEncargo: 1623 } : { ...p, emAberto: false }));
  return f;
}

// ContaFaturaService de verdade (a conta é a do motor), com o carregamento do banco dublado.
export function contaFaturaCom(conta: ContaCarregada = contaFixture([F2ComParcial()])) {
  const servico = new ContaFaturaService({ db: {} } as never);
  jest.spyOn(servico, 'carregar').mockResolvedValue(conta);
  return servico;
}

// Banco "frouxo": qualquer modelo/método existe e devolve o vazio do seu tipo
// (findMany → [], findFirst → null, count → 0…), salvo o que o teste definir.
// \`chamadas.modelo.metodo\` é o jest.fn usado, para conferir o que foi gravado.
type Fn = jest.Mock;
export function bancoFrouxo(definidos: Record<string, Record<string, Fn>> = {}) {
  const chamadas: Record<string, Record<string, Fn>> = {};
  const padrao = (metodo: string): unknown =>
    metodo === 'findMany' || metodo === 'groupBy' ? [] : metodo === 'count' ? 0 : metodo === 'aggregate' ? { _sum: {}, _count: {} } : metodo.startsWith('find') ? null : {};
  const db: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_alvo, modelo: string) => {
        if (modelo === '$transaction') return (fn: (tx: unknown) => Promise<unknown>) => fn(db);
        if (modelo === '$queryRaw') return () => Promise.resolve([]);
        if (modelo === 'then') return undefined; // não é uma Promise
        chamadas[modelo] ??= {};
        return new Proxy(
          {},
          {
            get: (_m, metodo: string) => {
              chamadas[modelo][metodo] ??= definidos[modelo]?.[metodo] ?? jest.fn().mockResolvedValue(padrao(metodo));
              return chamadas[modelo][metodo];
            },
          },
        );
      },
    },
  );
  return { db, chamadas };
}
