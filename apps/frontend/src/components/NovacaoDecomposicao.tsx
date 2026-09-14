import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { operacoesService, ComponenteDecomposicao } from '../services/operacoes.service';
import { Modal } from './Modal';

// ============================================================
// NOVAÇÃO — F1 (doc docs/novacao-adaptacoes-azit-2026-09.md, A7 passos 1–2):
// prévia da decomposição do saldo da conta por produto. Mostra ao operador,
// ANTES de qualquer proposta, o que a novação vai reorganizar:
//   Contrato 1 — Novação do veículo (vencido + todo o futuro a valor presente);
//   Contrato 2 — Termo de Regularização de Débitos (reembolso, seguro vencido
//   e a parte não-veículo de renegociações anteriores).
// A simulação/proposta em si é a F2 — esta tela é diagnóstico e memória.
// ============================================================

const PRODUTO_LABEL: Record<string, string> = {
  veiculo: 'Veículo',
  seguro: 'Seguro (vencido)',
  reembolso: 'Reembolso parcelado',
  outro: 'Outros encargos',
};

function LinhaValor({ label, valor, forte }: { label: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]" style={forte ? { fontWeight: 700 } : undefined}>
      <span style={{ color: forte ? 'var(--text-body)' : 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(valor)}</span>
    </div>
  );
}

function TabelaMemoria({ componentes }: { componentes: ComponenteDecomposicao[] }) {
  if (componentes.length === 0) return null;
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr style={{ color: 'var(--text-label)' }}>
          <th className="py-[3px] text-left font-semibold">Origem</th>
          <th className="text-left font-semibold">Situação</th>
          <th className="text-right font-semibold">Nominal</th>
          <th className="text-right font-semibold">Ajuste</th>
          <th className="text-right font-semibold">Valor</th>
        </tr>
      </thead>
      <tbody>
        {componentes.map((c, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
            <td className="py-[4px] pr-[8px]">{c.origem}</td>
            <td>{c.situacao === 'vencido' ? `vencida há ${c.dias}d` : `vence em ${c.dias}d`}</td>
            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.valorNominal)}</td>
            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums', color: c.ajuste >= 0 ? '#c0392b' : '#1e8e5a' }}>
              {c.ajuste >= 0 ? '+' : ''}{formatCurrency(c.ajuste)}
            </td>
            <td className="text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.valor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NovacaoDecomposicaoModal({ contaId, open, onClose }: { contaId: string; open: boolean; onClose: () => void }) {
  const [memoriaAberta, setMemoriaAberta] = useState(false);
  const dec = useQuery({
    queryKey: ['novacao-decomposicao', contaId],
    queryFn: () => operacoesService.decomposicaoNovacao(contaId),
    enabled: open && !!contaId,
  });

  const d = dec.data;
  return (
    <Modal open={open} onClose={onClose} title="Novação — decomposição do saldo por produto">
      {dec.isLoading && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Levantando o saldo da conta…</div>}
      {dec.isError && <div className="text-[12px]" style={{ color: '#c0392b' }}>Não foi possível levantar o saldo — tente de novo.</div>}
      {d && (
        <div className="flex flex-col gap-[14px]">
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Retrato da dívida na data-base de hoje, decomposto por produto: vencidos entram com multa e
            mora; todo o saldo futuro do veículo entra a valor presente pela taxa do contrato de origem;
            o seguro futuro não entra (o serviço continua); acordos anteriores são explodidos pela
            composição original, com os juros divididos em partes iguais entre os produtos.
          </div>

          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            {/* Contrato 1 — parte do veículo */}
            <div className="rounded-[12px] p-[14px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
              <div className="mb-[8px] font-display text-[12.5px] font-bold">Contrato 1 — Novação do veículo</div>
              <div className="flex flex-col gap-[4px]">
                <LinhaValor label="Vencido (com multa e mora)" valor={d.parteVeiculo.vencido} />
                <LinhaValor label="Futuro a valor presente" valor={d.parteVeiculo.futuro} />
                <LinhaValor label="Parte do veículo em acordos" valor={d.parteVeiculo.deAcordos} />
                <div className="my-[4px]" style={{ borderTop: '1px solid var(--border)' }} />
                <LinhaValor label="Saldo da parte do veículo" valor={d.parteVeiculo.total} forte />
              </div>
            </div>

            {/* Contrato 2 — demais produtos */}
            <div className="rounded-[12px] p-[14px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
              <div className="mb-[8px] font-display text-[12.5px] font-bold">Contrato 2 — Termo de Regularização de Débitos</div>
              {d.demaisProdutos.porProduto.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nada além do veículo — a novação teria só o Contrato 1.</div>
              ) : (
                <div className="flex flex-col gap-[4px]">
                  {d.demaisProdutos.porProduto.map((l) => (
                    <LinhaValor key={l.produto} label={PRODUTO_LABEL[l.produto] ?? l.produto} valor={l.total} />
                  ))}
                  <div className="my-[4px]" style={{ borderTop: '1px solid var(--border)' }} />
                  <LinhaValor label="Saldo dos demais produtos" valor={d.demaisProdutos.total} forte />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-[10px] px-[14px] py-[10px]" style={{ background: 'var(--navy)', color: '#fff' }}>
            <span className="text-[12.5px] font-semibold">Saldo total a reorganizar</span>
            <span className="font-display text-[15px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(d.totalGeral)}</span>
          </div>

          {d.memoria.ignorados.length > 0 && (
            <div className="rounded-[10px] px-[12px] py-[8px] text-[11.5px]" style={{ background: '#fff8e6', border: '1px solid #f0dfae', color: '#8a6d1a' }}>
              {d.memoria.ignorados.length} contribuição(ões) futura(s) de seguro fora da novação — o contrato de proteção continua normalmente.
            </div>
          )}

          {/* Memória de cálculo — auditável, componente a componente */}
          <div>
            <button
              onClick={() => setMemoriaAberta((v) => !v)}
              className="text-[12px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              {memoriaAberta ? '▾ Ocultar memória de cálculo' : '▸ Ver memória de cálculo'}
            </button>
            {memoriaAberta && (
              <div className="mt-[8px] flex flex-col gap-[12px]">
                <TabelaMemoria componentes={d.memoria.componentes} />
                {d.memoria.acordos.filter((a) => a.saldoAberto > 0).map((a) => (
                  <div key={a.acordoId} className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
                    <div className="mb-[6px] text-[12px] font-semibold">
                      Acordo {a.acordoId.slice(-6)} · saldo em aberto {formatCurrency(a.saldoAberto)}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        {' '}— cobriu {formatCurrency(a.nominalCoberto)} + encargos {formatCurrency(a.encargosAcordo)} (divididos em partes iguais)
                      </span>
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      {a.porProduto.map((p) => (
                        <LinhaValor key={p.produto} label={`${PRODUTO_LABEL[p.produto] ?? p.produto} — fatia do saldo`} valor={p.saldo} />
                      ))}
                    </div>
                    <div className="mt-[6px]"><TabelaMemoria componentes={a.parcelasAbertas} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Esta é a base de cálculo da novação (F1). A simulação da proposta — taxa inicial de
            processamento, desconto de comitê, parcelas e sequenciamento dos dois contratos — vem em seguida.
          </div>
        </div>
      )}
    </Modal>
  );
}
