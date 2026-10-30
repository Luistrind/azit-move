import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, parcelasPorPrazoMeses } from '@azit/utils';
import { operacoesService, ComponenteDecomposicao, SimulacaoNovacao } from '../services/operacoes.service';
import { originacaoService } from '../services/originacao.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro } from '../lib/permissoes';
import { toast } from './Toast';
import { Modal } from './Modal';
import { Botao } from './Botao';

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
    <div className="flex items-center justify-between gap-[8px] text-[12px]" style={forte ? { fontWeight: 700 } : undefined}>
      <span style={{ color: forte ? 'var(--text-body)' : 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{formatCurrency(valor)}</span>
    </div>
  );
}

// Memória AGREGADA por produto × situação (correção 14/09: um contrato de 209
// parcelas listava tudo e estourava o modal). O parcela-a-parcela abre sob
// demanda, dentro de área com rolagem própria.
function TabelaMemoria({ componentes, rotuloGrupo }: { componentes: ComponenteDecomposicao[]; rotuloGrupo?: string }) {
  const [detalhe, setDetalhe] = useState(false);
  if (componentes.length === 0) return null;

  const grupos = new Map<string, { rotulo: string; qtde: number; nominal: number; ajuste: number; valor: number }>();
  for (const c of componentes) {
    const chave = `${c.produto}|${c.situacao}`;
    const g = grupos.get(chave) ?? {
      rotulo: `${rotuloGrupo ?? PRODUTO_LABEL[c.produto] ?? c.produto} — ${c.situacao === 'vencido' ? 'vencidas (com mora)' : 'a vencer (valor presente)'}`,
      qtde: 0, nominal: 0, ajuste: 0, valor: 0,
    };
    g.qtde += 1;
    g.nominal += c.valorNominal;
    g.ajuste += c.ajuste;
    g.valor += c.valor;
    grupos.set(chave, g);
  }

  // Layout v2 (doc 03 §11): cabeçalho no eyebrow do sistema; a grade rola só dentro dela no celular.
  const th = { color: 'var(--text-label)' } as const;
  const thCls = 'py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.1em]';
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-[11.5px]" style={{ color: 'var(--text-primary)' }}>
        <thead>
          <tr style={th}>
            <th className={`${thCls} text-left`}>Grupo</th>
            <th className={`${thCls} text-right`}>Parcelas</th>
            <th className={`${thCls} text-right`}>Nominal</th>
            <th className={`${thCls} text-right`}>Ajuste</th>
            <th className={`${thCls} text-right`}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {[...grupos.values()].map((g, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="py-[4px] pr-[8px]">{g.rotulo}</td>
              <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{g.qtde}</td>
              <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(g.nominal)}</td>
              <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums', color: g.ajuste >= 0 ? 'var(--danger-fg)' : 'var(--ok-fg)' }}>
                {g.ajuste >= 0 ? '+' : ''}{formatCurrency(g.ajuste)}
              </td>
              <td className="text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(g.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <Botao tamanho="sm" variante="fantasma" className="self-start" onClick={() => setDetalhe((v) => !v)}>
        {detalhe ? '▾ Ocultar parcela a parcela' : `▸ Ver parcela a parcela (${componentes.length})`}
      </Botao>
      {detalhe && (
        <div className="rounded-[10px]" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)' }}>
          <table className="w-full min-w-[460px] text-[11.5px]" style={{ color: 'var(--text-primary)' }}>
            <thead>
              <tr style={th}>
                <th className={`${thCls} pl-[8px] text-left`}>Origem</th>
                <th className={`${thCls} text-left`}>Situação</th>
                <th className={`${thCls} text-right`}>Nominal</th>
                <th className={`${thCls} text-right`}>Ajuste</th>
                <th className={`${thCls} pr-[8px] text-right`}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {componentes.map((c, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-[4px] pl-[8px] pr-[8px]">{c.origem}</td>
                  <td>{c.situacao === 'vencido' ? `vencida há ${c.dias}d` : `vence em ${c.dias}d`}</td>
                  <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.valorNominal)}</td>
                  <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums', color: c.ajuste >= 0 ? 'var(--danger-fg)' : 'var(--ok-fg)' }}>
                    {c.ajuste >= 0 ? '+' : ''}{formatCurrency(c.ajuste)}
                  </td>
                  <td className="pr-[8px] text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Decomposição do saldo por produto — Contrato 1 (veículo) × Contrato 2 (demais)
// e o total a reorganizar. Um só componente para a prévia (ficha do titular) e
// para o detalhe da novação em Renegociações (snapshot congelado), 21/10.
export function BlocoDecomposicao({
  parteVeiculo,
  demaisProdutos,
  totalGeral,
  rotuloTotal,
}: {
  parteVeiculo: { vencido: number; futuro: number; deAcordos: number; total: number };
  demaisProdutos: { porProduto: { produto: string; total: number }[]; total: number };
  totalGeral: number;
  rotuloTotal?: string;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        {/* Contrato 1 — parte do veículo */}
        <div className="rounded-[12px] p-[14px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <div className="mb-[8px] font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Contrato 1 — Novação do veículo</div>
          <div className="flex flex-col gap-[4px]">
            <LinhaValor label="Vencido (com multa e mora)" valor={parteVeiculo.vencido} />
            <LinhaValor label="Futuro a valor presente" valor={parteVeiculo.futuro} />
            <LinhaValor label="Parte do veículo em acordos" valor={parteVeiculo.deAcordos} />
            <div className="my-[4px]" style={{ borderTop: '1px solid var(--border)' }} />
            <LinhaValor label="Saldo da parte do veículo" valor={parteVeiculo.total} forte />
          </div>
        </div>

        {/* Contrato 2 — demais produtos */}
        <div className="rounded-[12px] p-[14px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <div className="mb-[8px] font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Contrato 2 — Termo de Regularização de Débitos</div>
          {demaisProdutos.porProduto.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nada além do veículo — a novação teria só o Contrato 1.</div>
          ) : (
            <div className="flex flex-col gap-[4px]">
              {demaisProdutos.porProduto.map((l) => (
                <LinhaValor key={l.produto} label={PRODUTO_LABEL[l.produto] ?? l.produto} valor={l.total} />
              ))}
              <div className="my-[4px]" style={{ borderTop: '1px solid var(--border)' }} />
              <LinhaValor label="Saldo dos demais produtos" valor={demaisProdutos.total} forte />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-[6px] rounded-[10px] px-[14px] py-[10px]" style={{ background: 'var(--navy)', color: '#fff' }}>
        <span className="text-[12.5px] font-semibold">{rotuloTotal ?? 'Saldo total a reorganizar'}</span>
        <span className="font-display text-[15px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalGeral)}</span>
      </div>
    </>
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
    <Modal open={open} onClose={onClose} largura={720} title="Novação — decomposição do saldo por produto">
      {dec.isLoading && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Levantando o saldo da conta…</div>}
      {dec.isError && <div className="text-[12px]" style={{ color: 'var(--danger-fg)' }}>Não foi possível levantar o saldo — tente de novo.</div>}
      {d && (
        <div className="flex flex-col gap-[14px]">
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Retrato da dívida na data-base de hoje, decomposto por produto: vencidos entram com multa e
            mora; todo o saldo futuro do veículo entra a valor presente pela taxa do contrato de origem;
            o seguro futuro não entra (o serviço continua); acordos anteriores são explodidos pela
            composição original, com os juros divididos em partes iguais entre os produtos.
          </div>

          <BlocoDecomposicao parteVeiculo={d.parteVeiculo} demaisProdutos={d.demaisProdutos} totalGeral={d.totalGeral} />

          {d.memoria.ignorados.length > 0 && (
            <div className="rounded-[10px] px-[12px] py-[8px] text-[11.5px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--border)', color: 'var(--warn-ink)' }}>
              {d.memoria.ignorados.length} contribuição(ões) futura(s) de seguro fora da novação — o contrato de proteção continua normalmente.
            </div>
          )}

          {/* Memória de cálculo — auditável, componente a componente */}
          <div>
            <Botao tamanho="sm" variante="fantasma" onClick={() => setMemoriaAberta((v) => !v)}>
              {memoriaAberta ? '▾ Ocultar memória de cálculo' : '▸ Ver memória de cálculo'}
            </Botao>
            {memoriaAberta && (
              <div className="mt-[8px] flex flex-col gap-[12px]">
                <TabelaMemoria componentes={d.memoria.componentes} />
                {d.memoria.acordos.filter((a) => a.saldoAberto > 0).map((a) => (
                  <div key={a.acordoId} className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
                    <div className="mb-[6px] text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
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
                    <div className="mt-[6px]"><TabelaMemoria componentes={a.parcelasAbertas} rotuloGrupo="Parcelas do plano do acordo" /></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Simulação da proposta (A7 passos 3-4): parcela única, Contrato 2
              primeiro, fatura de transição, depois o veículo. */}
          <BlocoSimulacao contaId={contaId} frequenciaHerdada={d.frequenciaHerdada} />
        </div>
      )}
    </Modal>
  );
}

const FREQ_LABEL = { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' } as const;

function BlocoSimulacao({ contaId, frequenciaHerdada }: { contaId: string; frequenciaHerdada: 'semanal' | 'quinzenal' | 'mensal' }) {
  const [aberto, setAberto] = useState(false);
  // Prazo em MESES, como na simulação da originação — a frequência dita o
  // nº de parcelas pelo fator padrão 4,3452/2,1726 (correção 14/09).
  const [prazoMeses, setPrazoMeses] = useState('24');
  const [frequencia, setFrequencia] = useState<'semanal' | 'quinzenal' | 'mensal'>(frequenciaHerdada);
  const [recebimento, setRecebimento] = useState('');
  const [desconto, setDesconto] = useState('');
  // Troca de veículo (F3 — A5): ativo DISPONÍVEL do estoque; ajuste pelo
  // valor de cadastro (entra − sai), nunca informado livremente.
  const [trocaAtivoId, setTrocaAtivoId] = useState('');
  // Acréscimo ao saldo (09/10, Luís): ex.: orçamento da avaria do veículo
  // devolvido na troca — soma à dívida, com motivo obrigatório.
  const [acrescimo, setAcrescimo] = useState('');
  const [acrescimoMotivo, setAcrescimoMotivo] = useState('');
  // Contrato único (adaptação 13/10): enquanto o instrumento de novação não
  // sai do jurídico, a operação vira UM contrato de Compra Parcelada com o
  // valor global — mesma precificação, modelo padrão do contrato de veículo.
  const [contratoUnico, setContratoUnico] = useState(false);
  // 1ª parcela do contrato novo (15/10): vazio = ciclo da conta (a simulação
  // devolve a sugestão); o operador escolhe outra antes de propor.
  const [primeiraParcela, setPrimeiraParcela] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [sim, setSim] = useState<SimulacaoNovacao | null>(null);
  const disponiveis = useQuery({
    queryKey: ['ativos-disponiveis-novacao'],
    queryFn: () => originacaoService.ativosDisponiveis(),
  });
  // Proposta formal (F2): congela a simulação e vai à Central de Aprovações.
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);

  const meses = parseInt(prazoMeses || '0', 10);
  const parcelasPrevistas = meses > 0 ? parcelasPorPrazoMeses(meses, frequencia) : 0;

  async function simular() {
    if (!meses || meses < 1) return;
    setOcupado(true);
    try {
      const r = await operacoesService.simularNovacao(contaId, {
        prazoMeses: meses,
        frequencia,
        recebimentoInicial: reaisParaCentavos(recebimento) || undefined,
        desconto: reaisParaCentavos(desconto) || undefined,
        trocaAtivoId: trocaAtivoId || undefined,
        acrescimo: reaisParaCentavos(acrescimo) || undefined,
        acrescimoMotivo: acrescimoMotivo.trim() || undefined,
        dataPrimeiraParcela: primeiraParcela || undefined,
      });
      setSim(r);
      if (!primeiraParcela) setPrimeiraParcela(r.dataPrimeiraParcela);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function enviarParaAprovacao() {
    if (!sim || enviando) return;
    setEnviando(true);
    try {
      await operacoesService.solicitarNovacao(contaId, {
        prazoMeses: meses,
        frequencia,
        recebimentoInicial: reaisParaCentavos(recebimento) || undefined,
        desconto: reaisParaCentavos(desconto) || undefined,
        trocaAtivoId: trocaAtivoId || undefined,
        acrescimo: reaisParaCentavos(acrescimo) || undefined,
        acrescimoMotivo: acrescimoMotivo.trim() || undefined,
        dataPrimeiraParcela: primeiraParcela || undefined,
        contratoUnico: contratoUnico || undefined,
        observacao: observacao.trim() || undefined,
      });
      setEnviada(true);
      toast.sucesso(contratoUnico
        ? 'Novação enviada para a Central de Aprovações (CONAC — 2 aprovações). Aprovada, nasce UM contrato de Compra Parcelada com o valor global e vai para assinatura.'
        : 'Novação enviada para a Central de Aprovações (CONAC — operação sensível, exige 2 aprovações). Aprovada, os dois contratos vão juntos para assinatura.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <Botao variante="primaria" onClick={() => setAberto(true)}>
        Simular proposta de novação
      </Botao>
    );
  }

  return (
    <div className="rounded-[12px] p-[14px]" style={{ border: '1px solid var(--border)' }}>
      <div className="mb-[10px] font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Simulação da proposta</div>
      <div className="flex flex-wrap items-end gap-[12px]">
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Prazo (meses)</span>
          <input value={prazoMeses} onChange={(e) => setPrazoMeses(e.target.value)} className="h-[34px] w-[90px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Frequência</span>
          <select value={frequencia} onChange={(e) => setFrequencia(e.target.value as typeof frequencia)} className="h-[34px] w-[110px] rounded-[8px] px-[8px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {(['semanal', 'quinzenal', 'mensal'] as const).map((f) => (
              <option key={f} value={f}>{FREQ_LABEL[f]}{f === frequenciaHerdada ? ' (atual)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>1ª parcela</span>
          <input type="date" value={primeiraParcela} onChange={(e) => setPrimeiraParcela(e.target.value)} title="Vazio = próximo ciclo da conta. Mensal: mesmo dia em cada mês; mês sem o dia cai no último dia." className="h-[34px] w-[150px] rounded-[8px] px-[8px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Recebimento inicial (R$) — opcional</span>
          <input value={recebimento} onChange={(e) => setRecebimento(e.target.value)} placeholder="0,00" className="h-[34px] w-[130px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Desconto (R$) — exige comitê</span>
          <input value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" className="h-[34px] w-[120px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Trocar veículo (opcional) — estoque disponível</span>
          <select value={trocaAtivoId} onChange={(e) => setTrocaAtivoId(e.target.value)} className="h-[34px] w-full max-w-[280px] rounded-[10px] px-[8px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="">Manter o veículo atual</option>
            {disponiveis.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.descricao}{a.placa ? ` · ${a.placa}` : ''}{a.valorVenda ? ` · ${formatCurrency(a.valorVenda)}` : ' · sem valor de cadastro'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Acréscimo ao saldo (R$) — ex.: avaria do veículo devolvido</span>
          <input value={acrescimo} onChange={(e) => setAcrescimo(e.target.value)} placeholder="0,00" className="h-[34px] w-[130px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </label>
        {reaisParaCentavos(acrescimo) > 0 && (
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Motivo do acréscimo (vai para o instrumento)</span>
            <input value={acrescimoMotivo} onChange={(e) => setAcrescimoMotivo(e.target.value)} placeholder="ex.: reparo da avaria do HB20 — orçamento nº 123" maxLength={200} className="h-[34px] w-full max-w-[320px] rounded-[10px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </label>
        )}
        <Botao variante="primaria" onClick={() => void simular()} disabled={ocupado || (reaisParaCentavos(acrescimo) > 0 && !acrescimoMotivo.trim())}>
          {ocupado ? 'Calculando…' : 'Simular'}
        </Botao>
      </div>
      {parcelasPrevistas > 0 && (
        <div className="mt-[6px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {meses} meses na frequência {FREQ_LABEL[frequencia].toLowerCase()} = <b>{parcelasPrevistas} parcelas</b> do contrato do veículo
        </div>
      )}

      {sim && (
        <div className="mt-[14px] flex flex-col gap-[12px]">
          {sim.excecoes.length > 0 && (
            <div className="rounded-[10px] px-[12px] py-[8px] text-[11.5px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--border)', color: 'var(--warn-ink)' }}>
              {sim.excecoes.map((e, i) => <div key={i}>⚠ {e}</div>)}
            </div>
          )}

          <label className="flex items-start gap-[8px] rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--border)', color: 'var(--warn-ink)' }}>
            <input type="checkbox" checked={contratoUnico} onChange={(e) => setContratoUnico(e.target.checked)} className="mt-[2px]" />
            <span>
              <b>Contrato único</b> (adaptação até o instrumento de novação ficar pronto): em vez de dois contratos, nasce <b>um contrato de Compra Parcelada</b> do veículo
              {sim.troca ? ' da troca' : ''}, com o valor global de <b>{formatCurrency(sim.totalAPagar)}</b> em <b>{sim.contrato2.totalParcelas + sim.contrato1.totalParcelas} parcelas</b> de {formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)} {sim.contrato1.valorUltima > 0 ? <> (última de {formatCurrency(sim.contrato1.valorUltima + (sim.comissaoPorPeriodo ?? 0) + (sim.protecaoPorPeriodo ?? 0))})</> : null}, no modelo padrão do contrato de veículo — mesma precificação, sem Termo e sem fatura de transição.
            </span>
          </label>

          {/* 1ª parcela (15/10): o que vai para o instrumento e manda na ativação. */}
          <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>
            1ª parcela em <b>{sim.dataPrimeiraParcela.split('-').reverse().join('/')}</b>
            {sim.dataPrimeiraParcela === sim.dataPrimeiraParcelaPadrao ? ' (próximo ciclo da conta)' : ` (escolhida; o ciclo da conta seria ${sim.dataPrimeiraParcelaPadrao.split('-').reverse().join('/')})`}
            {sim.frequencia === 'mensal' ? ` · todo dia ${parseInt(sim.dataPrimeiraParcela.slice(8, 10), 10)}; mês sem esse dia vence no último dia` : ''}
          </div>

          <div className="rounded-[10px] px-[14px] py-[10px]" style={{ background: 'var(--navy)', color: '#fff' }}>
            <div className="flex flex-wrap items-center justify-between gap-[6px]">
              <span className="text-[12.5px] font-semibold">Parcela única do relacionamento ({FREQ_LABEL[sim.frequencia].toLowerCase()})</span>
              <span className="font-display text-[15px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)}</span>
            </div>
            {/* F4 (A4.4): o valor apresentado é o valor cobrado — composição visível. */}
            {(sim.comissaoPorPeriodo > 0 || sim.protecaoPorPeriodo > 0) && (
              <div className="mt-[4px] text-[11px]" style={{ color: 'var(--navy-text-body)' }}>
                {formatCurrency(sim.valorParcela)} financeira
                {sim.comissaoPorPeriodo > 0 ? ` + ${formatCurrency(sim.comissaoPorPeriodo)} comissão recorrente` : ''}
                {sim.protecaoPorPeriodo > 0 ? ` + ${formatCurrency(sim.protecaoPorPeriodo)} proteção veicular` : ''}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <div className="rounded-[12px] p-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <div className="mb-[6px] font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Cadeia do contrato do veículo</div>
              {sim.troca && (
                <div className="mb-[6px] rounded-[8px] px-[10px] py-[6px] text-[11.5px]" style={{ background: 'var(--info-bg)', color: 'var(--text-primary)' }}>
                  🔁 Troca: sai <b>{sim.troca.saiDescricao}</b> ({formatCurrency(sim.troca.saiValor)}) → entra <b>{sim.troca.entraDescricao}</b> ({formatCurrency(sim.troca.entraValor)})
                </div>
              )}
              <div className="flex flex-col gap-[3px]">
                {sim.troca || sim.acrescimo > 0 ? (
                  <>
                    <LinhaValor label="Parte do veículo (decomposição)" valor={sim.decomposicao.parteVeiculo.total} />
                    {sim.troca && <LinhaValor label="Ajuste da troca (entra − sai)" valor={sim.troca.ajuste} />}
                    {sim.acrescimo > 0 && <LinhaValor label={`Acréscimo — ${sim.acrescimoMotivo ?? 'motivo não informado'}`} valor={sim.acrescimo} />}
                    <LinhaValor label={sim.troca ? 'Saldo-base (com a troca)' : 'Saldo-base (com o acréscimo)'} valor={sim.saldoBase} />
                  </>
                ) : (
                  <LinhaValor label="Saldo-base (parte do veículo)" valor={sim.saldoBase} />
                )}
                {sim.saldoNovado !== sim.saldoBase && <LinhaValor label="Saldo novado (após desconto)" valor={sim.saldoNovado} />}
                <LinhaValor label="Taxa inicial de processamento" valor={sim.taxaInicial} />
                {sim.amortizacaoInicial > 0 && <LinhaValor label="Recebimento que amortiza" valor={sim.amortizacaoInicial} />}
                {sim.tpFinanciada > 0 && <LinhaValor label="Taxa diluída nas parcelas" valor={sim.tpFinanciada} />}
                <div className="my-[3px]" style={{ borderTop: '1px solid var(--border)' }} />
                <LinhaValor label="Saldo a parcelar do veículo" valor={sim.saldoAParcelarVeiculo} forte />
              </div>
            </div>
            <div className="rounded-[12px] p-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <div className="mb-[6px] font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Sequência das faturas</div>
              <div className="flex flex-col gap-[4px] text-[12px]" style={{ color: 'var(--text-primary)' }}>
                {sim.contrato2.totalParcelas > 0 ? (
                  <>
                    {/* Termo menor que uma parcela: resolve-se INTEIRO na fatura
                        de transição — não mostrar "0×" (feedback Luís 14/09). */}
                    {sim.contrato2.parcelasCheias > 0 && (
                      <div>1º — <b>Termo de Regularização de Débitos</b>: {sim.contrato2.parcelasCheias}× {formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)}</div>
                    )}
                    <div>
                      {sim.contrato2.parcelasCheias > 0 ? '2º' : '1º'} — <b>Fatura de transição</b>: {formatCurrency(sim.contrato2.valorUltima)}
                      {sim.contrato2.parcelasCheias > 0 ? ' do Termo' : ' do Termo de Regularização de Débitos (resolve-se inteiro aqui)'} + {formatCurrency(sim.contrato2.antecipacaoTransicao)} antecipados do veículo{(sim.protecaoPorPeriodo ?? 0) > 0 ? ` + ${formatCurrency(sim.protecaoPorPeriodo)} de proteção` : ''}
                    </div>
                    <div>{sim.contrato2.parcelasCheias > 0 ? '3º' : '2º'} — <b>Veículo</b>: {sim.contrato1.parcelasCheias}× {formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)}{sim.contrato1.valorUltima > 0 && sim.contrato1.valorUltima !== sim.valorParcela ? ` + última de ${formatCurrency(sim.contrato1.valorUltima + (sim.comissaoPorPeriodo ?? 0) + (sim.protecaoPorPeriodo ?? 0))}` : sim.contrato1.valorUltima > 0 ? ' + última' : ''}</div>
                    <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      Durante a fase do Termo, o saldo do veículo fica congelado (sem juros e sem comissão — o valor da comissão amortiza o próprio Termo); a proteção é cobrada desde a 1ª fatura.
                    </div>
                  </>
                ) : (
                  <div>Sem dívida fora do veículo — só o contrato do veículo: {sim.contrato1.parcelasCheias}× {formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)}{sim.contrato1.valorUltima > 0 && sim.contrato1.valorUltima !== sim.valorParcela ? ` + última de ${formatCurrency(sim.contrato1.valorUltima + (sim.comissaoPorPeriodo ?? 0) + (sim.protecaoPorPeriodo ?? 0))}` : ''}</div>
                )}
                <div className="my-[3px]" style={{ borderTop: '1px solid var(--border)' }} />
                <LinhaValor label={`Total do relacionamento (${sim.totalParcelasRelacionamento} parcelas)`} valor={sim.totalAPagar} forte />
              </div>
            </div>
          </div>

          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Taxa financeira de {(sim.taxaMensal * 100).toFixed(2).replace('.', ',')}% ao mês
            (equivalente por {FREQ_LABEL[sim.frequencia].toLowerCase()}) · parâmetros {sim.produtoAtivo ? `da versão ${sim.versaoParametros} do Catálogo` : 'padrão do produto (V1.0)'}
          </div>

          {/* Proposta formal (F2): números do servidor congelados no snapshot. */}
          {enviada ? (
            <div className="rounded-[10px] px-[14px] py-[10px] text-[12.5px] font-semibold" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>
              ✓ Proposta enviada para a Central de Aprovações — acompanhe em Aprovações e na tela de Acordos e novações.
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-[10px] rounded-[12px] p-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <label className="flex min-w-[240px] flex-1 flex-col gap-[4px]">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Observação (opcional)</span>
                <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Contexto para o comitê…" className="h-[34px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </label>
              <Botao
                variante="primaria"
                onClick={() => void enviarParaAprovacao()}
                disabled={enviando || !sim.produtoAtivo}
                title={sim.produtoAtivo ? undefined : 'Ative o produto Novação no Catálogo para contratar'}
              >
                {enviando ? 'Enviando…' : 'Enviar para aprovação'}
              </Botao>
              {!sim.produtoAtivo && (
                <div className="w-full text-[11.5px]" style={{ color: 'var(--warn-ink)' }}>
                  A contratação exige o produto Novação ATIVO no Catálogo — a simulação acima usa os parâmetros padrão.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
