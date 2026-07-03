import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { titularService } from '../services/titular.service';
import { faturaService } from '../services/fatura.service';
import { originacaoService } from '../services/originacao.service';
import { creditoService } from '../services/credito.service';
import { produtoService } from '../services/produto.service';
import { reguaService } from '../services/regua.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro, usePodeRole, ROLE_OPERACAO } from '../lib/permissoes';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { toast } from '../components/Toast';
import { CONTRATO_STATUS_COLORS } from '../config/statusColors';

const card = { background: 'var(--surface)', border: '1px solid var(--border)' };

// Situação da fatura calculada em runtime (Regra 7).
const SITUACAO: Record<string, { bg: string; fg: string; label: string }> = {
  em_aberto: { bg: '#eef2f7', fg: '#5b6b7f', label: 'Em aberto' },
  vence_hoje: { bg: '#fff4e0', fg: '#a86a12', label: 'Vence hoje' },
  vencida: { bg: '#fdeceb', fg: '#c0392b', label: 'Vencida' },
  paga: { bg: '#eafaf1', fg: '#1f9d5b', label: 'Paga' },
  paga_em_atraso: { bg: '#eafaf1', fg: '#1f9d5b', label: 'Paga (em atraso)' },
};

const DOC_LABEL: Record<string, string> = {
  cnh: 'CNH', comprovante_endereco: 'Comprovante de endereço',
  comprovante_renda: 'Comprovante de renda', relatorio_brick: 'Relatório Brick', outro: 'Outro',
};

function fmtData(iso: string | null): string {
  return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
}

function diasDeAtraso(iso: string): number {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(iso); v.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((hoje.getTime() - v.getTime()) / 86400000));
}

function Metrica({ label, valor, alerta }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="mt-[4px] font-display text-[17px] font-bold tabular-nums" style={{ color: alerta ? '#c0392b' : 'var(--text-primary)' }}>{valor}</div>
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string | null }) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{valor || '—'}</div>
    </div>
  );
}

const PAGE = 8;

export function TitularDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pagina, setPagina] = useState(1);
  const [faturaSel, setFaturaSel] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Hub de ações do titular: contratar crédito, renegociar, desbloquear.
  const pode = usePodeRole();
  const [renegOpen, setRenegOpen] = useState(false);
  const [desbloqueando, setDesbloqueando] = useState(false);

  // Contratar crédito avulso (Doc 2 §4.7-A) — produto do catálogo + finalidade livre.
  const [creditoOpen, setCreditoOpen] = useState(false);
  const [creditoBusy, setCreditoBusy] = useState(false);
  const [cProdutoId, setCProdutoId] = useState('');
  const [cFinalidade, setCFinalidade] = useState('');
  const [cValor, setCValor] = useState('');
  const [cParcelas, setCParcelas] = useState('12');
  const [cEntrada, setCEntrada] = useState('');
  const [cPeriodicidade, setCPeriodicidade] = useState<'semanal' | 'quinzenal' | 'mensal'>('mensal');

  const produtos = useQuery({
    queryKey: ['produtos'],
    queryFn: () => produtoService.listar(),
    enabled: creditoOpen,
  });
  // Produtos de crédito de valor variável (não âncora, parcelados, ativos).
  const produtosCredito = (produtos.data ?? []).filter(
    (p) => p.ativo && !p.ancora && p.natureza === 'parcelado',
  );
  const produtoSel = produtosCredito.find((p) => p.id === cProdutoId);

  const cValorCent = reaisParaCentavos(cValor);
  const cEntradaCent = reaisParaCentavos(cEntrada);
  const cNumParcelas = Math.max(1, parseInt(cParcelas || '0', 10) || 0);
  const cParcelaPrev =
    cValorCent > 0 && cNumParcelas > 0
      ? Math.round((cValorCent - cEntradaCent) / cNumParcelas)
      : 0;

  async function contratarCredito() {
    if (cValorCent <= 0 || cNumParcelas <= 0) return;
    setCreditoBusy(true);
    try {
      const nomeProduto = produtoSel?.nome ?? 'Crédito avulso';
      const r = await creditoService.originar(id, {
        descricao: cFinalidade.trim() ? `${nomeProduto} — ${cFinalidade.trim()}` : nomeProduto,
        valor: cValorCent,
        numeroParcelas: cNumParcelas,
        valorEntrada: cEntradaCent,
        periodicidade: cPeriodicidade,
      });
      setCreditoOpen(false);
      setCValor('');
      setCEntrada('');
      setCFinalidade('');
      await recarregar();
      await queryClient.invalidateQueries({ queryKey: ['aprovacoes-contagem'] });
      toast.sucesso(`Crédito ${r.numero} enviado para a Central de Aprovações.`);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setCreditoBusy(false);
    }
  }

  async function desbloquear(contratoId: string) {
    setDesbloqueando(true);
    try {
      await reguaService.desbloquear(contratoId);
      await recarregar();
      toast.sucesso('Contrato desbloqueado.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setDesbloqueando(false);
    }
  }

  async function recarregar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['titular-detalhe', id] }),
      queryClient.invalidateQueries({ queryKey: ['titular-faturas'] }),
      queryClient.invalidateQueries({ queryKey: ['fatura-detalhe'] }),
    ]);
  }
  // Dev: paga a fatura (conciliação é assíncrona — aguarda o worker e recarrega).
  async function pagarFatura(faturaId: string) {
    setOcupado(true);
    try { await faturaService.simularPagamento(faturaId); await new Promise((r) => setTimeout(r, 1200)); await recarregar(); }
    finally { setOcupado(false); }
  }
  // Dev: +1 dia de atraso por clique.
  async function atrasarFatura(faturaId: string) {
    setOcupado(true);
    try { await faturaService.envelhecer(faturaId); await recarregar(); }
    finally { setOcupado(false); }
  }

  const det = useQuery({ queryKey: ['titular-detalhe', id], queryFn: () => titularService.detalhe(id), enabled: !!id });
  const contaId = det.data?.conta?.id;
  const faturas = useQuery({
    queryKey: ['titular-faturas', contaId, pagina],
    queryFn: () => faturaService.daConta(contaId!, pagina, PAGE),
    enabled: !!contaId,
  });
  const faturaDet = useQuery({
    queryKey: ['fatura-detalhe', faturaSel],
    queryFn: () => faturaService.detalhe(faturaSel!),
    enabled: !!faturaSel,
  });

  if (det.isLoading) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  if (!det.data) return <div className="p-[24px] text-[13px]">Titular não encontrado.</div>;
  const { titular: t, resumoFinanceiro: rf, documentos, contratosCredito } = det.data;
  const totalPaginas = faturas.data ? Math.max(1, Math.ceil(faturas.data.total / PAGE)) : 1;

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      {/* Header + hub de ações contextuais (a ficha do titular é o hub de operações) */}
      <div className="flex flex-wrap items-center gap-[12px]">
        <button onClick={() => navigate('/titulares')} className="rounded-[8px] px-[10px] py-[6px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>← Titulares</button>
        <div>
          <div className="font-display text-[18px] font-bold">{t.nome}</div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t.tipoPessoa.toUpperCase()} · {t.cpfCnpj} · conta {det.data.conta?.status ?? '—'}</div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-[8px]">
          <button
            onClick={() => setCreditoOpen(true)}
            className="h-[32px] rounded-[9px] px-[14px] text-[12px] font-semibold"
            style={{ background: 'var(--navy)', color: '#fff' }}
          >
            + Contratar crédito
          </button>
          {rf.valorEmAtraso > 0 && contaId && (
            <button
              onClick={() => setRenegOpen(true)}
              className="h-[32px] rounded-[9px] px-[14px] text-[12px] font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Renegociar atraso
            </button>
          )}
        </div>
      </div>

      {/* Banner de bloqueio (D+3 — desbloqueio sempre manual, Doc 2 Regra 6) */}
      {contratosCredito.some((c) => c.status.toLowerCase() === 'bloqueado') && (
        <div className="flex flex-wrap items-center gap-[10px] rounded-[12px] px-[16px] py-[12px]" style={{ background: '#fdeceb', border: '1px solid #f5c6c3' }}>
          <span className="text-[16px]">🔒</span>
          <div className="flex-1 text-[12.5px]" style={{ color: '#c0392b' }}>
            <b>Conta bloqueada</b> — bloqueio D+3 por inadimplência. O desbloqueio é sempre manual.
          </div>
          {pode(ROLE_OPERACAO) &&
            contratosCredito
              .filter((c) => c.status.toLowerCase() === 'bloqueado')
              .map((c) => (
                <button
                  key={c.id}
                  disabled={desbloqueando}
                  onClick={() => desbloquear(c.id)}
                  className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50"
                  style={{ background: '#c0392b', color: '#fff' }}
                >
                  Desbloquear {c.numero}
                </button>
              ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        {/* Bloco 1 — Dados pessoais + documentos */}
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[12px] font-display text-[13px] font-bold">Dados pessoais</div>
          <div className="grid grid-cols-2 gap-[12px]">
            <Campo label="Nome" valor={t.nome} />
            <Campo label="CPF/CNPJ" valor={t.cpfCnpj} />
            <Campo label="RG" valor={t.rg} />
            <Campo label="WhatsApp" valor={t.whatsapp} />
            <Campo label="E-mail" valor={t.email} />
            <Campo label="Estado civil" valor={t.estadoCivil} />
            <Campo label="Profissão" valor={t.profissao} />
            <Campo label="Endereço" valor={t.endereco} />
            <Campo label="Bairro" valor={t.bairro} />
            <Campo label="Cidade/UF" valor={[t.cidade, t.estado].filter(Boolean).join(' / ') || null} />
            <Campo label="CEP" valor={t.cep} />
          </div>
          <div className="mt-[14px] mb-[8px] text-[12px] font-semibold" style={{ color: 'var(--text-label)' }}>Documentos</div>
          {documentos.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum documento anexado.</div>
          ) : (
            <div className="flex flex-col gap-[6px]">
              {documentos.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-[8px] px-[10px] py-[7px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
                  <span>{DOC_LABEL[d.tipo] ?? d.tipo} <span style={{ color: 'var(--text-muted)' }}>· {fmtData(d.dataAnexo)}</span></span>
                  <button onClick={() => originacaoService.baixarDocumento(d.id, d.arquivoRef)} className="font-semibold" style={{ color: 'var(--navy)' }}>Baixar</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bloco 2 — Informações gerais com a Azit */}
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[12px] font-display text-[13px] font-bold">Relacionamento com a Azit</div>
          <div className="grid grid-cols-2 gap-[10px]">
            <Metrica label="Em contrato ativo" valor={formatCurrency(rf.valorEmContratoAtivo)} />
            <Metrica label="Pago até o momento" valor={formatCurrency(rf.valorPago)} />
            <Metrica label="Saldo devedor" valor={formatCurrency(rf.saldoDevedor)} />
            <Metrica label="Em atraso" valor={formatCurrency(rf.valorEmAtraso)} alerta={rf.valorEmAtraso > 0} />
            <Metrica label="Renegociações" valor={String(rf.quantidadeRenegociacoes)} />
            <Metrica label="Contratos ativos" valor={`${rf.contratosAtivos} de ${rf.contratosTotal}`} />
          </div>
        </div>
      </div>

      {/* Bloco 3 — Contratos */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="mb-[12px] font-display text-[13px] font-bold">Contratos ({contratosCredito.length})</div>
        {contratosCredito.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum contrato vinculado.</div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="py-[8px] text-left font-semibold">Contrato</th>
                <th className="py-[8px] text-left font-semibold">Assinado</th>
                <th className="py-[8px] text-right font-semibold">Valor</th>
                <th className="py-[8px] text-right font-semibold">Saldo devedor</th>
                <th className="py-[8px] text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {contratosCredito.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/contratos/${c.id}`)} className="cursor-pointer hover:bg-[var(--surface-input)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="py-[9px] font-semibold">{c.numero}</td>
                  <td className="py-[9px]" style={{ color: 'var(--text-body)' }}>{fmtData(c.dataAssinatura)}</td>
                  <td className="py-[9px] text-right tabular-nums">{formatCurrency(c.valorTotal)}</td>
                  <td className="py-[9px] text-right tabular-nums">{formatCurrency(c.saldoDevedor)}</td>
                  <td className="py-[9px]"><StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Bloco 4 — Histórico de faturas (paginado) */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="mb-[12px] flex items-center justify-between">
          <span className="font-display text-[13px] font-bold">Histórico de faturas{faturas.data ? ` (${faturas.data.total})` : ''}</span>
          {faturas.data && faturas.data.total > PAGE && (
            <div className="flex items-center gap-[8px] text-[12px]">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-[7px] px-[9px] py-[5px] font-semibold disabled:opacity-40" style={{ background: 'var(--surface-input)' }}>←</button>
              <span style={{ color: 'var(--text-muted)' }}>{pagina} / {totalPaginas}</span>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-[7px] px-[9px] py-[5px] font-semibold disabled:opacity-40" style={{ background: 'var(--surface-input)' }}>→</button>
            </div>
          )}
        </div>
        {!contaId ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem conta — faturas nascem na ativação do contrato.</div>
        ) : (faturas.data?.data.length ?? 0) === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhuma fatura.</div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="py-[8px] text-left font-semibold">Fatura</th>
                <th className="py-[8px] text-left font-semibold">Vencimento</th>
                <th className="py-[8px] text-right font-semibold">Valor</th>
                <th className="py-[8px] text-left font-semibold">Situação</th>
                <th className="py-[8px]"></th>
              </tr>
            </thead>
            <tbody>
              {faturas.data!.data.map((f) => {
                const s = SITUACAO[f.situacao] ?? { bg: '#eef2f7', fg: '#5b6b7f', label: f.situacao };
                return (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="py-[9px] font-semibold">#{f.numero}</td>
                    <td className="py-[9px]" style={{ color: 'var(--text-body)' }}>{fmtData(f.dataVencimento)}</td>
                    <td className="py-[9px] text-right tabular-nums">{formatCurrency(f.valorTotal)}</td>
                    <td className="py-[9px]"><span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: s.bg, color: s.fg }}>{s.label}</span></td>
                    <td className="py-[9px] text-right"><button onClick={() => setFaturaSel(f.id)} className="text-[12px] font-semibold" style={{ color: 'var(--navy)' }}>Detalhe</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal — detalhe da fatura */}
      <Modal open={!!faturaSel} onClose={() => setFaturaSel(null)} title={faturaDet.data ? `Fatura #${faturaDet.data.numero}` : 'Fatura'}>
        {!faturaDet.data ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            <div className="grid grid-cols-2 gap-[10px]">
              <Campo label="Vencimento" valor={fmtData(faturaDet.data.dataVencimento)} />
              <Campo label="Fechamento" valor={fmtData(faturaDet.data.dataFechamento)} />
              <Campo label="Pagamento" valor={fmtData(faturaDet.data.dataPagamento)} />
              <Campo label="Situação" valor={(SITUACAO[faturaDet.data.situacao]?.label) ?? faturaDet.data.situacao} />
            </div>
            <div>
              <div className="mb-[6px] text-[12px] font-semibold" style={{ color: 'var(--text-label)' }}>Composição</div>
              <div className="flex flex-col gap-[4px]">
                {faturaDet.data.itens.map((it, i) => (
                  <div key={i} className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-body)' }}>
                    <span>{it.descricao} <span style={{ color: 'var(--text-muted)' }}>· {it.credor} · {it.tipo}</span></span>
                    <span className="tabular-nums">{formatCurrency(it.valor)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-[10px] text-[13px] font-bold" style={{ borderColor: 'var(--border)' }}>
              <span>Total {faturaDet.data.valorPago > 0 ? `· pago ${formatCurrency(faturaDet.data.valorPago)}` : ''}</span>
              <span className="tabular-nums">{formatCurrency(faturaDet.data.valorTotal)}</span>
            </div>

            {/* Ações dev — paga a FATURA; atraso aumenta dia a dia. Só fora de produção:
                em produção o cliente paga a cobrança no Asaas e o webhook concilia. */}
            {import.meta.env.DEV && (() => {
              const fd = faturaDet.data;
              const paga = fd.status === 'paga' || fd.status === 'paga_em_atraso';
              const atraso = diasDeAtraso(fd.dataVencimento);
              return (
                <div className="flex flex-col gap-[8px] border-t pt-[12px]" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>
                    Simulação (dev){atraso > 0 ? ` · ${atraso} dia(s) de atraso` : ''}
                  </div>
                  <div className="flex flex-wrap gap-[8px]">
                    {!paga && (
                      <button disabled={ocupado} onClick={() => pagarFatura(fd.id)} className="h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
                        Simular pagamento
                      </button>
                    )}
                    {!paga && (
                      <button disabled={ocupado} onClick={() => atrasarFatura(fd.id)} className="h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold disabled:opacity-50" style={{ background: '#fdeceb', color: '#c0392b' }}>
                        + 1 dia de atraso
                      </button>
                    )}
                    {paga && <span className="text-[12px] font-semibold" style={{ color: '#1f9d5b' }}>✓ Fatura paga</span>}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Contratar crédito avulso — produto do catálogo + finalidade; decisão na Central. */}
      <Modal open={creditoOpen} onClose={() => setCreditoOpen(false)} title="Contratar crédito">
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-2 gap-[10px]">
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Produto</span>
              <select
                value={cProdutoId}
                onChange={(e) => {
                  setCProdutoId(e.target.value);
                  const p = produtosCredito.find((x) => x.id === e.target.value);
                  if (p?.valorPadrao) setCValor((p.valorPadrao / 100).toFixed(2).replace('.', ','));
                }}
                className="h-[34px] rounded-[8px] px-[10px] text-[13px]"
                style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
              >
                <option value="">Crédito avulso (genérico)</option>
                {produtosCredito.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Finalidade (opcional)</span>
              <input value={cFinalidade} onChange={(e) => setCFinalidade(e.target.value)} placeholder="ex: manutenção do veículo" className="h-[34px] rounded-[8px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Valor do crédito (R$)</span>
              <input value={cValor} onChange={(e) => setCValor(e.target.value)} placeholder="5.000,00" className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Entrada (R$, opcional)</span>
              <input value={cEntrada} onChange={(e) => setCEntrada(e.target.value)} placeholder="0,00" className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nº de parcelas</span>
              <input value={cParcelas} onChange={(e) => setCParcelas(e.target.value.replace(/\D/g, ''))} className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Periodicidade</span>
              <select value={cPeriodicidade} onChange={(e) => setCPeriodicidade(e.target.value as typeof cPeriodicidade)} className="h-[34px] rounded-[8px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                <option value="semanal">Semanal</option>
                <option value="quinzenal">Quinzenal</option>
                <option value="mensal">Mensal</option>
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[10px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Parcela estimada <span title="Juros a definir (Vicente) — cálculo provisório">(provisório)</span></span>
            <span className="font-bold tabular-nums">{cNumParcelas}× {formatCurrency(cParcelaPrev)}</span>
          </div>
          <button
            disabled={creditoBusy || cValorCent <= 0 || cNumParcelas <= 0}
            onClick={contratarCredito}
            className="h-[38px] rounded-[9px] text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {creditoBusy ? 'Enviando…' : 'Enviar para aprovação'}
          </button>
        </div>
      </Modal>

      {/* Wizard de renegociação conta-cêntrica (Doc 2 §7.7) */}
      {renegOpen && contaId && (
        <RenegociacaoWizard contaId={contaId} titular={t.nome} onClose={() => { setRenegOpen(false); void recarregar(); }} />
      )}
    </div>
  );
}
