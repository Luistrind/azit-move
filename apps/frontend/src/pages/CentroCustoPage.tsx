import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { centroCustoService } from '../services/centro-custo.service';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';

const TIPOS_CUSTO = ['manutencao', 'documentacao', 'seguro', 'franquia', 'preparacao', 'outro'];
const TIPO_LABEL: Record<string, string> = {
  manutencao: 'Manutenção', documentacao: 'Documentação', seguro: 'Seguro',
  franquia: 'Franquia', preparacao: 'Preparação', outro: 'Outro',
};
const inputCls = 'h-[32px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };

function Resultado({ valor }: { valor: number }) {
  return (
    <span className="font-bold tabular-nums" style={{ color: valor >= 0 ? '#1f9d5b' : '#c0392b' }}>
      {valor >= 0 ? '+' : '−'}{formatCurrency(Math.abs(valor))}
    </span>
  );
}

// Centro de custo (Doc 2 §4.4-A): por veículo (gasto × recebido × resultado) e
// crédito avulso como centro próprio (liberado × retornado).
export function CentroCustoPage() {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<'veiculos' | 'credito'>('veiculos');
  const [ativoSel, setAtivoSel] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [lanc, setLanc] = useState({ tipo: 'manutencao', descricao: '', valor: '' });

  const ativos = useQuery({ queryKey: ['cc-ativos'], queryFn: () => centroCustoService.ativos() });
  const credito = useQuery({
    queryKey: ['cc-credito'],
    queryFn: () => centroCustoService.creditoAvulso(),
    enabled: aba === 'credito',
  });
  const detalhe = useQuery({
    queryKey: ['cc-detalhe', ativoSel],
    queryFn: () => centroCustoService.detalhe(ativoSel!),
    enabled: !!ativoSel,
  });

  async function recarregar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cc-ativos'] }),
      queryClient.invalidateQueries({ queryKey: ['cc-detalhe'] }),
    ]);
  }

  async function adicionarLancamento() {
    if (!ativoSel) return;
    setSalvando(true);
    try {
      await centroCustoService.criarLancamento(ativoSel, {
        tipo: lanc.tipo,
        descricao: lanc.descricao.trim(),
        valor: reaisParaCentavos(lanc.valor),
      });
      setLanc({ tipo: 'manutencao', descricao: '', valor: '' });
      await recarregar();
      toast.sucesso('Custo lançado.');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    try {
      await centroCustoService.removerLancamento(id);
      await recarregar();
      toast.info('Lançamento removido.');
    } catch (e) { toast.erro(mensagemErro(e)); }
  }

  const totais = (ativos.data ?? []).reduce(
    (t, a) => ({ gasto: t.gasto + a.totalGasto, recebido: t.recebido + a.recebido, aReceber: t.aReceber + a.aReceber }),
    { gasto: 0, recebido: 0, aReceber: 0 },
  );

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center gap-[10px]">
        {(['veiculos', 'credito'] as const).map((t) => (
          <button key={t} onClick={() => setAba(t)}
            className="h-[32px] rounded-[9px] px-[14px] text-[12.5px] font-semibold"
            style={aba === t ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)' }}>
            {t === 'veiculos' ? `Veículos${ativos.data ? ` (${ativos.data.length})` : ''}` : 'Crédito avulso'}
          </button>
        ))}
      </div>

      {aba === 'veiculos' && (
        <>
          <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
            <Kpi rotulo="Total investido" valor={formatCurrency(totais.gasto)} />
            <Kpi rotulo="Total recebido" valor={formatCurrency(totais.recebido)} />
            <Kpi rotulo="A receber" valor={formatCurrency(totais.aReceber)} />
            <Kpi rotulo="Resultado" valor={<Resultado valor={totais.recebido - totais.gasto} />} />
          </div>

          <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                  <th className="px-[16px] py-[12px] text-left font-semibold">Veículo</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Aquisição</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Custos</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Recebido</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">A receber</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {ativos.isLoading && <tr><td colSpan={6} className="px-[16px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Carregando…</td></tr>}
                {ativos.data?.length === 0 && <tr><td colSpan={6} className="px-[16px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhum veículo cadastrado.</td></tr>}
                {ativos.data?.map((a) => (
                  <tr key={a.ativoId} onClick={() => setAtivoSel(a.ativoId)}
                    className="cursor-pointer transition-colors hover:bg-[var(--surface-muted)]"
                    style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-[16px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {a.descricao}{a.placa ? ` · ${a.placa}` : ''}
                      <div className="text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>{a.status}</div>
                    </td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums">{a.aquisicao ? formatCurrency(a.aquisicao) : '—'}</td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums">{a.custosExtras ? formatCurrency(a.custosExtras) : '—'}</td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums">{formatCurrency(a.recebido)}</td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatCurrency(a.aReceber)}</td>
                    <td className="px-[16px] py-[12px] text-right"><Resultado valor={a.resultado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === 'credito' && (
        <>
          <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
            <Kpi rotulo="Créditos concedidos" valor={String(credito.data?.quantidade ?? '—')} />
            <Kpi rotulo="Total liberado" valor={formatCurrency(credito.data?.totalLiberado ?? 0)} />
            <Kpi rotulo="Retornado" valor={formatCurrency(credito.data?.totalRetornado ?? 0)} />
            <Kpi rotulo="Em aberto" valor={formatCurrency(credito.data?.totalEmAberto ?? 0)} />
          </div>
          <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                  <th className="px-[16px] py-[12px] text-left font-semibold">Contrato</th>
                  <th className="px-[16px] py-[12px] text-left font-semibold">Titular</th>
                  <th className="px-[16px] py-[12px] text-left font-semibold">Finalidade</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Liberado</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Retornado</th>
                  <th className="px-[16px] py-[12px] text-right font-semibold">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {credito.data?.creditos.length === 0 && <tr><td colSpan={6} className="px-[16px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhum crédito avulso concedido.</td></tr>}
                {credito.data?.creditos.map((c) => (
                  <tr key={c.contratoId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-[16px] py-[12px] font-semibold">{c.numero}<div className="text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>{c.status}</div></td>
                    <td className="px-[16px] py-[12px]">{c.titular}</td>
                    <td className="px-[16px] py-[12px]">{c.finalidade}</td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums">{formatCurrency(c.liberado)}</td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums">{formatCurrency(c.retornado)}</td>
                    <td className="px-[16px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatCurrency(c.emAberto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Detalhe do veículo: posição + lançamentos de custo */}
      <Modal open={!!ativoSel} onClose={() => setAtivoSel(null)} title={detalhe.data ? `${detalhe.data.descricao}${detalhe.data.placa ? ` · ${detalhe.data.placa}` : ''}` : 'Centro de custo'}>
        {!detalhe.data ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="flex flex-col gap-[14px]">
            <div className="grid grid-cols-2 gap-[8px] text-[12px]">
              <div className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
                <div style={{ color: 'var(--text-muted)' }}>Gasto (aquisição + custos)</div>
                <div className="text-[14px] font-bold tabular-nums">{formatCurrency(detalhe.data.totalGasto)}</div>
              </div>
              <div className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
                <div style={{ color: 'var(--text-muted)' }}>Recebido · a receber</div>
                <div className="text-[14px] font-bold tabular-nums">{formatCurrency(detalhe.data.recebido)} <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>· {formatCurrency(detalhe.data.aReceber)}</span></div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[8px] text-[13px] font-bold" style={{ background: 'var(--surface-input)' }}>
              <span>Resultado</span><Resultado valor={detalhe.data.resultado} />
            </div>

            {detalhe.data.contratos.length > 0 && (
              <div className="flex flex-col gap-[4px] text-[12px]">
                <div className="font-semibold" style={{ color: 'var(--text-label)' }}>Contratos</div>
                {detalhe.data.contratos.map((c) => (
                  <div key={c.contratoId} className="flex justify-between">
                    <span>{c.numero} · {c.titular} <span style={{ color: 'var(--text-muted)' }}>({c.status})</span></span>
                    <span className="tabular-nums">{formatCurrency(c.entradaPaga + c.parcelasPagas)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-[6px]">
              <div className="text-[12px] font-semibold" style={{ color: 'var(--text-label)' }}>Lançamentos de custo</div>
              {detalhe.data.lancamentos.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum custo lançado além da aquisição.</div>}
              {detalhe.data.lancamentos.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-[8px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
                  <span><b>{TIPO_LABEL[l.tipo] ?? l.tipo}</b> · {l.descricao} <span style={{ color: 'var(--text-muted)' }}>· {new Date(l.data).toLocaleDateString('pt-BR')}</span></span>
                  <span className="flex items-center gap-[8px]">
                    <span className="tabular-nums font-semibold">{formatCurrency(l.valor)}</span>
                    <button onClick={() => remover(l.id)} className="text-[13px]" style={{ color: '#c0392b' }} title="Remover">×</button>
                  </span>
                </div>
              ))}
              <div className="mt-[4px] flex flex-wrap items-end gap-[8px]">
                <select value={lanc.tipo} onChange={(e) => setLanc({ ...lanc, tipo: e.target.value })} className={inputCls} style={inputStyle}>
                  {TIPOS_CUSTO.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </select>
                <input value={lanc.descricao} onChange={(e) => setLanc({ ...lanc, descricao: e.target.value })} placeholder="Descrição" className={`${inputCls} flex-1`} style={inputStyle} />
                <input value={lanc.valor} onChange={(e) => setLanc({ ...lanc, valor: e.target.value })} placeholder="R$" className={`${inputCls} w-[100px] text-right`} style={inputStyle} />
                <button onClick={adicionarLancamento} disabled={salvando || !lanc.descricao.trim() || reaisParaCentavos(lanc.valor) <= 0}
                  className="h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50"
                  style={{ background: 'var(--navy)', color: '#fff' }}>+ Lançar</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-card p-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>{rotulo}</div>
      <div className="mt-[4px] font-display text-[18px] font-bold">{valor}</div>
    </div>
  );
}
