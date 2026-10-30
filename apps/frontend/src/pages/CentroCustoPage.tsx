import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { centroCustoService, type CentroCustoAtivo, type CentroCustoCredito } from '../services/centro-custo.service';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';
import { Metrica } from '../components/Metrica';
import { Bloco } from '../components/Bloco';
import { Chips } from '../components/Chips';
import { Tabela, type Coluna } from '../components/Tabela';
import { Secao } from '../components/Secao';
import { Botao } from '../components/Botao';
import { dataMistaBR } from '../lib/datas';

const TIPOS_CUSTO = ['manutencao', 'documentacao', 'seguro', 'franquia', 'preparacao', 'outro'];
const TIPO_LABEL: Record<string, string> = {
  manutencao: 'Manutenção', documentacao: 'Documentação', seguro: 'Seguro',
  franquia: 'Franquia', preparacao: 'Preparação', outro: 'Outro',
};
const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };

function Resultado({ valor }: { valor: number }) {
  return (
    <span className="font-bold tabular-nums" style={{ color: valor >= 0 ? 'var(--ok-fg)' : 'var(--danger-fg)' }}>
      {valor >= 0 ? '+' : '−'}{formatCurrency(Math.abs(valor))}
    </span>
  );
}

type Credito = CentroCustoCredito['creditos'][number];

// Centro de custo (Doc 2 §4.4-A): por veículo (gasto × recebido × resultado) e
// crédito avulso como centro próprio (liberado × retornado). Layout v2 (doc 03
// §11): painel em <Bloco> com Leitura do Hub, grade em <Tabela>, abas em <Chips>.
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
  const resultadoFrota = totais.recebido - totais.gasto;
  const cr = credito.data;

  const colunasVeiculo: Coluna<CentroCustoAtivo>[] = [
    { chave: 'veiculo', titulo: 'Veículo', celular: 'titulo', render: (a) => `${a.descricao}${a.placa ? ` · ${a.placa}` : ''}` },
    { chave: 'status', titulo: 'Situação', celular: 'subtitulo', render: (a) => a.status },
    { chave: 'aquisicao', titulo: 'Aquisição', alinhar: 'right', classe: 'tabular-nums', celular: 'campo', render: (a) => (a.aquisicao ? formatCurrency(a.aquisicao) : '—') },
    { chave: 'custos', titulo: 'Custos', alinhar: 'right', classe: 'tabular-nums', celular: 'campo', render: (a) => (a.custosExtras ? formatCurrency(a.custosExtras) : '—') },
    { chave: 'recebido', titulo: 'Recebido', alinhar: 'right', classe: 'tabular-nums', celular: 'campo', render: (a) => formatCurrency(a.recebido) },
    { chave: 'aReceber', titulo: 'A receber', alinhar: 'right', classe: 'tabular-nums', celular: 'campo', render: (a) => <span style={{ color: 'var(--text-muted)' }}>{formatCurrency(a.aReceber)}</span> },
    { chave: 'resultado', titulo: 'Resultado', alinhar: 'right', celular: 'destaque', render: (a) => <Resultado valor={a.resultado} /> },
  ];

  const colunasCredito: Coluna<Credito>[] = [
    { chave: 'numero', titulo: 'Contrato', celular: 'titulo', render: (c) => `${c.numero} · ${c.status}` },
    { chave: 'titular', titulo: 'Titular', celular: 'subtitulo', render: (c) => c.titular },
    { chave: 'finalidade', titulo: 'Finalidade', celular: 'campo', render: (c) => c.finalidade },
    { chave: 'liberado', titulo: 'Liberado', alinhar: 'right', classe: 'tabular-nums', celular: 'campo', render: (c) => formatCurrency(c.liberado) },
    { chave: 'retornado', titulo: 'Retornado', alinhar: 'right', classe: 'tabular-nums', celular: 'campo', render: (c) => formatCurrency(c.retornado) },
    { chave: 'emAberto', titulo: 'Em aberto', alinhar: 'right', classe: 'tabular-nums', celular: 'destaque', render: (c) => formatCurrency(c.emAberto) },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <Chips
        todos={null}
        valor={aba}
        onChange={(k) => { if (k === 'veiculos' || k === 'credito') setAba(k); }}
        itens={[
          { chave: 'veiculos', rotulo: 'Veículos', contagem: ativos.data?.length },
          { chave: 'credito', rotulo: 'Crédito avulso', contagem: cr?.quantidade },
        ]}
      />

      {aba === 'veiculos' && (
        <>
          <Bloco
            titulo="Posição da frota"
            tag={ativos.data ? `${ativos.data.length} ${ativos.data.length === 1 ? 'veículo' : 'veículos'}` : undefined}
            leitura={
              ativos.data
                ? <>Gasto <b>{formatCurrency(totais.gasto)}</b> × recebido <b>{formatCurrency(totais.recebido)}</b>: resultado de <Resultado valor={resultadoFrota} />, com {formatCurrency(totais.aReceber)} ainda a receber.</>
                : 'Carregando…'
            }
          >
            <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
              <Metrica tom="kpi" label="Total investido" valor={formatCurrency(totais.gasto)} detalhe="aquisição + custos" />
              <Metrica tom="kpi" label="Total recebido" valor={formatCurrency(totais.recebido)} />
              <Metrica tom="kpi" label="A receber" valor={formatCurrency(totais.aReceber)} />
              <Metrica tom="kpi" label="Resultado" valor={<Resultado valor={resultadoFrota} />} alerta={resultadoFrota < 0} />
            </div>
          </Bloco>

          <Tabela
            colunas={colunasVeiculo}
            linhas={ativos.data ?? []}
            chave={(a) => a.ativoId}
            carregando={ativos.isLoading}
            vazio="Nenhum veículo cadastrado."
            larguraMinima={760}
            onClick={(a) => setAtivoSel(a.ativoId)}
          />
        </>
      )}

      {aba === 'credito' && (
        <>
          <Bloco
            titulo="Crédito avulso"
            tag={cr ? `${cr.quantidade} ${cr.quantidade === 1 ? 'crédito' : 'créditos'}` : undefined}
            leitura={
              cr
                ? <>Liberados <b>{formatCurrency(cr.totalLiberado)}</b>, retornados <b>{formatCurrency(cr.totalRetornado)}</b>; {formatCurrency(cr.totalEmAberto)} em aberto.</>
                : 'Carregando…'
            }
          >
            <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
              <Metrica tom="kpi" label="Créditos concedidos" valor={String(cr?.quantidade ?? '—')} />
              <Metrica tom="kpi" label="Total liberado" valor={formatCurrency(cr?.totalLiberado ?? 0)} />
              <Metrica tom="kpi" label="Retornado" valor={formatCurrency(cr?.totalRetornado ?? 0)} />
              <Metrica tom="kpi" label="Em aberto" valor={formatCurrency(cr?.totalEmAberto ?? 0)} />
            </div>
          </Bloco>
          <Tabela
            colunas={colunasCredito}
            linhas={cr?.creditos ?? []}
            chave={(c) => c.contratoId}
            carregando={credito.isLoading}
            vazio="Nenhum crédito avulso concedido."
            larguraMinima={720}
          />
        </>
      )}

      {/* Detalhe do veículo: posição + lançamentos de custo */}
      <Modal open={!!ativoSel} onClose={() => setAtivoSel(null)} title={detalhe.data ? `${detalhe.data.descricao}${detalhe.data.placa ? ` · ${detalhe.data.placa}` : ''}` : 'Centro de custo'}>
        {!detalhe.data ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="flex flex-col gap-[14px]">
            <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
              <Metrica label="Gasto" valor={formatCurrency(detalhe.data.totalGasto)} detalhe="aquisição + custos" />
              <Metrica label="Recebido" valor={formatCurrency(detalhe.data.recebido)} detalhe={`a receber ${formatCurrency(detalhe.data.aReceber)}`} />
            </div>
            <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[8px] text-[13px] font-bold" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
              <span>Resultado</span><Resultado valor={detalhe.data.resultado} />
            </div>

            {detalhe.data.contratos.length > 0 && (
              <Secao titulo="Contratos">
                <div className="flex flex-col gap-[4px] text-[12px]" style={{ color: 'var(--text-primary)' }}>
                  {detalhe.data.contratos.map((c) => (
                    <div key={c.contratoId} className="flex justify-between gap-[8px]">
                      <span>{c.numero} · {c.titular} <span style={{ color: 'var(--text-muted)' }}>({c.status})</span></span>
                      <span className="tabular-nums">{formatCurrency(c.entradaPaga + c.parcelasPagas)}</span>
                    </div>
                  ))}
                </div>
              </Secao>
            )}

            <Secao titulo="Lançamentos de custo">
              <div className="flex flex-col gap-[6px]">
                {detalhe.data.lancamentos.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum custo lançado além da aquisição.</div>}
                {detalhe.data.lancamentos.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-[8px] rounded-[10px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                    <span><b>{TIPO_LABEL[l.tipo] ?? l.tipo}</b> · {l.descricao} <span style={{ color: 'var(--text-muted)' }}>· {dataMistaBR(l.data)}</span></span>
                    <span className="flex flex-none items-center gap-[8px]">
                      <span className="tabular-nums font-semibold">{formatCurrency(l.valor)}</span>
                      <button type="button" onClick={() => remover(l.id)} className="flex h-[30px] w-[30px] items-center justify-center text-[15px]" style={{ color: 'var(--danger-fg)' }} title="Remover" aria-label="Remover">×</button>
                    </span>
                  </div>
                ))}
                <div className="mt-[4px] grid grid-cols-1 items-end gap-[8px] sm:grid-cols-[auto_1fr_110px_auto]">
                  <select value={lanc.tipo} onChange={(e) => setLanc({ ...lanc, tipo: e.target.value })} className={inputCls} style={inputStyle}>
                    {TIPOS_CUSTO.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                  </select>
                  <input value={lanc.descricao} onChange={(e) => setLanc({ ...lanc, descricao: e.target.value })} placeholder="Descrição" className={`${inputCls} w-full`} style={inputStyle} />
                  <input value={lanc.valor} onChange={(e) => setLanc({ ...lanc, valor: e.target.value })} placeholder="R$" className={`${inputCls} w-full text-right`} style={inputStyle} />
                  <Botao variante="primaria" onClick={adicionarLancamento} carregando={salvando} disabled={!lanc.descricao.trim() || reaisParaCentavos(lanc.valor) <= 0}>+ Lançar</Botao>
                </div>
              </div>
            </Secao>
          </div>
        )}
      </Modal>
    </div>
  );
}
