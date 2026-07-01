import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { titularService } from '../services/titular.service';
import { faturaService } from '../services/fatura.service';
import { originacaoService } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
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
      {/* Header */}
      <div className="flex items-center gap-[12px]">
        <button onClick={() => navigate('/titulares')} className="rounded-[8px] px-[10px] py-[6px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>← Titulares</button>
        <div>
          <div className="font-display text-[18px] font-bold">{t.nome}</div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t.tipoPessoa.toUpperCase()} · {t.cpfCnpj} · conta {det.data.conta?.status ?? '—'}</div>
        </div>
      </div>

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
    </div>
  );
}
