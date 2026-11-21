import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { TIPOS_CUSTO_RECUPERACAO, TIPO_CUSTO_RECUPERACAO_LABEL, type TipoCustoRecuperacao } from '@azit/types';
import { operacoesService, type CustoRecuperacao, type DadosCustoRecuperacao } from '../services/operacoes.service';
import { CUSTO_QUEM_PAGA_COLORS, CUSTO_SITUACAO_COLORS } from '../config/statusColors';
import { Botao } from './Botao';
import { Tabela } from './Tabela';
import { StatusBadge } from './StatusBadge';
import { ModalConfirmacao } from './ModalConfirmacao';
import { toast } from './Toast';
import { mensagemErro, ROLE_CUSTO_RECUPERACAO, usePodeRole } from '../lib/permissoes';
import { dataBR, hojeBrasilISO } from '../lib/datas';
import { reaisParaCentavos } from '../lib/valor';

// Custos da recuperação do veículo (doc 02 §29.3, decisões Luís 20–21/11/2026).
// UM componente, usado na ficha do contrato (ativo ou rescindido) e dentro da
// janela de rescindir. Cada custo é um lançamento de custo do veículo ligado ao
// contrato; o que o cliente paga entra na dívida do acerto (orçado = estimativa),
// o que a Azit assume fica só como custo do veículo. Nenhuma conta aqui: totais e
// permissões de estado vêm do backend.

export const rotuloTipoCusto = (tipo: string) => TIPO_CUSTO_RECUPERACAO_LABEL[tipo as TipoCustoRecuperacao] ?? tipo;
const ROTULO_SITUACAO = { orcado: 'Orçado', pago: 'Pago' } as const;
const ROTULO_QUEM = { cliente: 'Cliente', azit: 'Azit assume' } as const;

const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const cls = 'h-[34px] w-full min-w-0 rounded-[10px] px-[10px] text-[13px]';

type Form = { tipo: string; descricao: string; valor: string; data: string; fornecedor: string; situacao: 'ORCADO' | 'PAGO'; quemPaga: 'CLIENTE' | 'AZIT'; arquivoNome: string; arquivoConteudo: string };
const formVazio = (): Form => ({ tipo: 'avaria', descricao: '', valor: '', data: hojeBrasilISO(), fornecedor: '', situacao: 'ORCADO', quemPaga: 'CLIENTE', arquivoNome: '', arquivoConteudo: '' });

function Campo({ rotulo, dica, children, className = '' }: { rotulo: string; dica?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-[4px] text-[12px] ${className}`}>
      <span className="font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}{dica ? <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {dica}</span> : null}</span>
      {children}
    </label>
  );
}

function Escolha<T extends string>({ valor, opcoes, onChange, nome }: { valor: T; opcoes: { v: T; rotulo: string }[]; onChange: (v: T) => void; nome: string }) {
  return (
    <span className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={nome}>
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={valor === o.v}
          onClick={() => onChange(o.v)}
          className="h-[34px] rounded-[10px] px-[12px] text-[12.5px] font-semibold"
          style={valor === o.v ? { background: 'var(--accent)', color: 'var(--navy)', border: '1px solid transparent' } : inputStyle}
        >
          {o.rotulo}
        </button>
      ))}
    </span>
  );
}

export function CustosRecuperacao({ contratoId, onMudou, compacto = false }: { contratoId: string; onMudou?: () => void | Promise<void>; compacto?: boolean }) {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const q = useQuery({ queryKey: ['contrato', contratoId, 'custos-recuperacao'], queryFn: () => operacoesService.custosRecuperacao(contratoId) });
  const [form, setForm] = useState<Form | null>(null);
  const [editando, setEditando] = useState<CustoRecuperacao | null>(null);
  const [removendo, setRemovendo] = useState<CustoRecuperacao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const d = q.data;
  const podeLancar = pode(ROLE_CUSTO_RECUPERACAO) && !!d && !d.motivoSemLancamento;
  // Acerto liquidado: custo do cliente não muda mais — a ação some (regra 13/11) e o motivo aparece.
  const clienteTravado = d?.motivoClienteTravado ?? null;
  const podeMexer = (c: CustoRecuperacao) => podeLancar && !(clienteTravado && c.quemPaga === 'cliente');

  async function aposMudar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['contrato', contratoId, 'custos-recuperacao'] }),
      queryClient.invalidateQueries({ queryKey: ['contrato', contratoId, 'rescisoes'] }),
      queryClient.invalidateQueries({ queryKey: ['rescisao-previa', contratoId] }),
    ]);
    await onMudou?.();
  }

  function lerArquivo(file: File | undefined) {
    if (!file) return;
    const leitor = new FileReader();
    leitor.onload = () => setForm((f) => (f ? { ...f, arquivoNome: file.name, arquivoConteudo: String(leitor.result ?? '') } : f));
    leitor.readAsDataURL(file);
  }

  function abrirNovo() {
    setEditando(null);
    setForm({ ...formVazio(), quemPaga: clienteTravado ? 'AZIT' : 'CLIENTE' });
  }
  function abrirEdicao(c: CustoRecuperacao) {
    setEditando(c);
    setForm({
      tipo: c.tipo, descricao: c.descricao, valor: (c.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), data: c.data, fornecedor: c.fornecedor ?? '',
      situacao: c.situacao === 'orcado' ? 'ORCADO' : 'PAGO', quemPaga: c.quemPaga === 'cliente' ? 'CLIENTE' : 'AZIT', arquivoNome: '', arquivoConteudo: '',
    });
  }

  async function salvar() {
    if (!form) return;
    const valor = reaisParaCentavos(form.valor);
    if (!form.descricao.trim()) { toast.erro('Escreva o que foi o custo.'); return; }
    if (valor <= 0) { toast.erro('Informe um valor maior que zero, por exemplo 450,00.'); return; }
    const corpo: DadosCustoRecuperacao = {
      tipo: form.tipo, descricao: form.descricao.trim(), valor, data: form.data || undefined, fornecedor: form.fornecedor.trim() || undefined,
      situacao: form.situacao, quemPaga: form.quemPaga,
      ...(form.arquivoConteudo ? { comprovante: { nome: form.arquivoNome, conteudo: form.arquivoConteudo } } : {}),
    };
    setOcupado(true);
    try {
      if (editando) await operacoesService.alterarCustoRecuperacao(editando.id, corpo);
      else await operacoesService.lancarCustoRecuperacao(contratoId, corpo);
      toast.sucesso(editando ? 'Custo alterado.' : 'Custo lançado.');
      setForm(null);
      setEditando(null);
      await aposMudar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!removendo) return;
    setOcupado(true);
    try {
      await operacoesService.removerCustoRecuperacao(removendo.id);
      toast.sucesso('Custo retirado.');
      setRemovendo(null);
      await aposMudar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (q.isLoading) return <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando os custos…</div>;
  if (!d) return null;
  const custos = d.custos;

  return (
    <div className="flex min-w-0 flex-col gap-[10px] text-[12.5px]">
      <div className="flex flex-wrap items-baseline gap-x-[22px] gap-y-[6px]">
        <span className="flex flex-col">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Do cliente</span>
          <b className="font-display text-[17px] tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(d.totais.cliente)}</b>
        </span>
        {d.totais.clienteOrcado > 0 && (
          <span className="flex flex-col">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>ainda orçado</span>
            <b className="font-display text-[15px] tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(d.totais.clienteOrcado)}</b>
          </span>
        )}
        {d.totais.azit > 0 && (
          <span className="flex flex-col">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Azit assume</span>
            <b className="font-display text-[15px] tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(d.totais.azit)}</b>
          </span>
        )}
        <span className="grow" />
        {podeLancar && !form && <Botao variante="primaria" tamanho="sm" onClick={abrirNovo}>+ Adicionar custo</Botao>}
      </div>

      {clienteTravado && <div className="rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-secondary)' }}>{clienteTravado}. Custo que a Azit assume ainda pode ser lançado.</div>}

      {form && (
        <div className="grid grid-cols-1 gap-[10px] rounded-[12px] p-[12px] sm:grid-cols-2 lg:grid-cols-4" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <Campo rotulo="Tipo">
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={cls} style={inputStyle}>
              {TIPOS_CUSTO_RECUPERACAO.map((t) => <option key={t} value={t}>{TIPO_CUSTO_RECUPERACAO_LABEL[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Descrição" className="lg:col-span-2">
            <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="ex.: para-choque traseiro amassado, orçamento da oficina" className={cls} style={inputStyle} autoFocus />
          </Campo>
          <Campo rotulo="Valor (R$)">
            <input value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} inputMode="decimal" placeholder="0,00" className={`${cls} tabular-nums`} style={inputStyle} />
          </Campo>
          <Campo rotulo="Data">
            <input type="date" value={form.data} max={hojeBrasilISO()} onChange={(e) => setForm({ ...form, data: e.target.value })} className={cls} style={inputStyle} />
          </Campo>
          <Campo rotulo="Fornecedor" dica="opcional">
            <input value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} placeholder="oficina, guincho, pátio…" className={cls} style={inputStyle} />
          </Campo>
          <Campo rotulo="Situação">
            <Escolha nome="Situação" valor={form.situacao} onChange={(v) => setForm({ ...form, situacao: v })} opcoes={[{ v: 'ORCADO', rotulo: 'Orçado' }, { v: 'PAGO', rotulo: 'Pago' }]} />
          </Campo>
          <Campo rotulo="Quem paga">
            <Escolha
              nome="Quem paga"
              valor={form.quemPaga}
              onChange={(v) => setForm({ ...form, quemPaga: v })}
              opcoes={clienteTravado && !(editando?.quemPaga === 'cliente') ? [{ v: 'AZIT', rotulo: 'Azit assume' }] : [{ v: 'CLIENTE', rotulo: 'Cliente' }, { v: 'AZIT', rotulo: 'Azit assume' }]}
            />
          </Campo>
          <Campo rotulo="Comprovante" dica={editando?.comprovante ? `já anexado: ${editando.comprovante} (enviar outro substitui)` : 'foto, orçamento ou nota — vai para o dossiê'} className="sm:col-span-2">
            <input type="file" accept="image/*,application/pdf" onChange={(e) => lerArquivo(e.target.files?.[0])} className="text-[12px]" />
          </Campo>
          <div className="flex flex-wrap items-end justify-end gap-[8px] sm:col-span-2">
            <Botao variante="secundaria" tamanho="sm" onClick={() => { setForm(null); setEditando(null); }} disabled={ocupado}>Cancelar</Botao>
            <Botao variante="primaria" tamanho="sm" onClick={() => void salvar()} carregando={ocupado}>{editando ? 'Salvar alteração' : 'Lançar custo'}</Botao>
          </div>
        </div>
      )}

      {custos.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>
          Nenhum custo lançado{d.motivoSemLancamento ? ` — ${d.motivoSemLancamento.toLowerCase()}` : ''}.
          {podeLancar ? ' Retomada, guincho, pátio, chave, avarias: o que for do cliente entra na dívida do acerto.' : ''}
        </div>
      ) : (
        <Tabela<CustoRecuperacao>
          semMoldura={compacto}
          colunas={[
            {
              chave: 'item', titulo: 'Item', celular: 'titulo',
              render: (c) => (
                <span className="flex flex-col gap-[2px]">
                  <b className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rotuloTipoCusto(c.tipo)}</b>
                  <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{c.descricao}{c.fornecedor ? ` · ${c.fornecedor}` : ''}</span>
                </span>
              ),
            },
            { chave: 'data', titulo: 'Data', celular: 'subtitulo', classe: 'tabular-nums', render: (c) => dataBR(c.data) },
            {
              chave: 'comprovante', titulo: 'Comprovante', celular: 'campo',
              render: (c) => c.comprovante
                ? <button type="button" className="text-left text-[12px] font-semibold underline" style={{ color: 'var(--text-primary)' }} onClick={() => operacoesService.abrirComprovanteCusto(c.id)} title={c.comprovante}>Abrir</button>
                : <span style={{ color: 'var(--warn-fg)' }}>sem comprovante</span>,
            },
            { chave: 'situacao', titulo: 'Situação', celular: 'campo', render: (c) => <StatusBadge label={ROTULO_SITUACAO[c.situacao]} colors={CUSTO_SITUACAO_COLORS} /> },
            { chave: 'quem', titulo: 'Quem paga', celular: 'campo', render: (c) => <StatusBadge label={ROTULO_QUEM[c.quemPaga]} colors={CUSTO_QUEM_PAGA_COLORS} /> },
            { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-semibold', render: (c) => formatCurrency(c.valor) },
          ]}
          linhas={custos}
          chave={(c) => c.id}
          larguraMinima={720}
          acoes={podeLancar ? (c) => (podeMexer(c) ? (
            <span className="flex gap-[4px]">
              <Botao variante="fantasma" tamanho="sm" onClick={() => abrirEdicao(c)} title={c.situacao === 'orcado' ? 'Trocar o valor pelo da nota, anexar o comprovante, mudar quem paga' : 'Alterar este custo'}>Alterar</Botao>
              <Botao variante="fantasma" tamanho="sm" onClick={() => setRemovendo(c)}>Retirar</Botao>
            </span>
          ) : null) : undefined}
        />
      )}

      <ModalConfirmacao
        open={!!removendo}
        titulo="Retirar este custo?"
        confirmar="Retirar custo"
        carregando={ocupado}
        onConfirmar={() => void remover()}
        onCancelar={() => setRemovendo(null)}
      >
        {removendo && (
          <>
            <b>{rotuloTipoCusto(removendo.tipo)}</b> · {removendo.descricao} · <b>{formatCurrency(removendo.valor)}</b>.
            {removendo.quemPaga === 'cliente' ? ' Sai da dívida do cliente; se o contrato já foi rescindido, o saldo do acerto é recalculado.' : ' Sai dos custos do veículo.'}
          </>
        )}
      </ModalConfirmacao>
    </div>
  );
}
