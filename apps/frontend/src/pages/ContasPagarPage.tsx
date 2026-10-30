import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  financeiroService,
  TituloPagarApi,
  OrcamentoApi,
  LotePagamentoApi,
  ConfiguracaoFinanceiro,
  LinhaCategoria,
} from '../services/financeiro.service';
import { rotuloStatus, ROTULO_RESPONSAVEL_ECONOMICO, ROTULO_STATUS_LOTE } from '../lib/rotulos';
import { mascararDinheiro, dinheiroParaCentavos, mascararCpfCnpj } from '../lib/mascaras';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import { Tabela, type Coluna } from '../components/Tabela';
import { CONTAS_PAGAR_STATUS_COLORS } from '../config/statusColors';
import { hojeBrasilISO } from '../lib/datas';
import { mensagemErro } from '../lib/permissoes';

// Contas a Pagar (doc 02 §18) — fila antes de ficha: abas por momento do fluxo,
// ação da etapa sempre visível, modais com contexto. Nada de sigla em tela.
// Layout v2 (doc 03 §11): abas e momentos em <Chips> (com contagem), fila de
// títulos em <Tabela> com as ações da etapa por linha, botões do kit.

const card = 'rounded-card p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const inputStyleClaro = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const lblCls = 'flex flex-col gap-[4px] text-[12px] font-semibold';

function reais(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
// Vencimento é data civil gravada à meia-noite UTC: sem o fuso fixo, aparecia
// um dia antes (20/10 virava 19/10) — mesma correção da régua (02/10).
function dataBR(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
}

function Chip({ status, deLote }: { status: string; deLote?: boolean }) {
  const c = CONTAS_PAGAR_STATUS_COLORS[status] ?? { bg: 'var(--surface-input)', fg: 'var(--text-label)' };
  const rotulo = deLote ? (ROTULO_STATUS_LOTE[status] ?? rotuloStatus(status)) : rotuloStatus(status);
  return (
    <span className="whitespace-nowrap rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {rotulo}
    </span>
  );
}

// Momentos da fila (fila antes de ficha — proposta UX P3).
const MOMENTOS: { chave: string; rotulo: string; status: string[] }[] = [
  { chave: 'validar', rotulo: 'Para validar', status: ['SOLICITADO', 'EM_VALIDACAO', 'BLOQUEADO', 'RASCUNHO'] },
  { chave: 'aprovacao', rotulo: 'Em aprovação', status: ['AGUARDANDO_APROVACAO', 'DEVOLVIDO'] },
  { chave: 'programacao', rotulo: 'Aprovados e lotes', status: ['APROVADO', 'PROGRAMADO', 'ENVIADO_BPO', 'AGUARDANDO_CORA'] },
  { chave: 'conciliar', rotulo: 'Pagos, a conciliar', status: ['PAGO'] },
  { chave: 'todos', rotulo: 'Todos', status: [] },
];

const ABAS = [
  ['titulos', 'Títulos'],
  ['orcamentos', 'Orçamentos'],
  ['lotes', 'Lotes de pagamento'],
  ['categorias', 'Por categoria'],
] as const;
type Aba = (typeof ABAS)[number][0];

export function ContasPagarPage() {
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>('titulos');
  const [momento, setMomento] = useState('validar');
  const [criandoTitulo, setCriandoTitulo] = useState(false);
  const [criandoOrcamento, setCriandoOrcamento] = useState(false);
  const [criandoLote, setCriandoLote] = useState(false);

  const config = useQuery({ queryKey: ['fin-config'], queryFn: () => financeiroService.configuracao() });
  const titulos = useQuery({ queryKey: ['fin-titulos'], queryFn: () => financeiroService.titulos(), enabled: aba === 'titulos' || aba === 'lotes' });
  const orcamentos = useQuery({ queryKey: ['fin-orcamentos'], queryFn: () => financeiroService.orcamentos(), enabled: aba === 'orcamentos' });
  const lotes = useQuery({ queryKey: ['fin-lotes'], queryFn: () => financeiroService.lotes(), enabled: aba === 'lotes' });

  async function recarregar() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['fin-titulos'] }),
      qc.invalidateQueries({ queryKey: ['fin-orcamentos'] }),
      qc.invalidateQueries({ queryKey: ['fin-lotes'] }),
      qc.invalidateQueries({ queryKey: ['aprovacoes-contagem'] }),
    ]);
  }

  const doMomento = useMemo(() => {
    const m = MOMENTOS.find((x) => x.chave === momento);
    const lista = titulos.data ?? [];
    return m && m.status.length > 0 ? lista.filter((t) => m.status.includes(t.status)) : lista;
  }, [titulos.data, momento]);

  const contagem = (m: (typeof MOMENTOS)[number]) =>
    titulos.data ? (m.status.length > 0 ? titulos.data.filter((t) => m.status.includes(t.status)).length : titulos.data.length) : undefined;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="m-0 max-w-[720px] text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Do pedido ao extrato: solicitação, validação, aprovação por alçada, lote por entidade,
          envio ao BPO, pagamento com comprovante e conciliação. Pago e Conciliado são etapas diferentes.
        </p>
        <div className="flex flex-wrap gap-[8px]">
          <Botao onClick={() => setCriandoOrcamento(true)}>+ Solicitar orçamento</Botao>
          <Botao variante="primaria" onClick={() => setCriandoTitulo(true)}>+ Nova despesa</Botao>
        </div>
      </div>

      <Chips
        todos={null}
        valor={aba}
        onChange={(k) => { if (k) setAba(k as Aba); }}
        itens={ABAS.map(([chave, rotulo]) => ({ chave, rotulo }))}
      />

      {aba === 'titulos' && (
        <>
          <Chips
            todos={null}
            tamanho="sm"
            valor={momento}
            onChange={(k) => { if (k) setMomento(k); }}
            itens={MOMENTOS.map((m) => ({ chave: m.chave, rotulo: m.rotulo, contagem: contagem(m) }))}
          />
          <ListaTitulos titulos={doMomento} carregando={titulos.isLoading} onMudou={recarregar} />
        </>
      )}

      {aba === 'orcamentos' && (
        <ListaOrcamentos orcamentos={orcamentos.data ?? []} carregando={orcamentos.isLoading} config={config.data} onMudou={recarregar} />
      )}

      {aba === 'lotes' && (
        <>
          <div>
            <Botao variante="primaria" onClick={() => setCriandoLote(true)}>+ Formar lote com títulos aprovados</Botao>
          </div>
          <ListaLotes lotes={lotes.data ?? []} carregando={lotes.isLoading} onMudou={recarregar} />
        </>
      )}

      {aba === 'categorias' && <QuadroCategorias />}

      {criandoTitulo && config.data && (
        <ModalNovaDespesa config={config.data} fechar={() => setCriandoTitulo(false)} onCriou={async () => { setCriandoTitulo(false); await recarregar(); }} />
      )}
      {criandoOrcamento && config.data && (
        <ModalNovoOrcamento config={config.data} fechar={() => setCriandoOrcamento(false)} onCriou={async () => { setCriandoOrcamento(false); setAba('orcamentos'); await recarregar(); }} />
      )}
      {criandoLote && config.data && (
        <ModalNovoLote config={config.data} titulos={(titulos.data ?? []).filter((t) => t.status === 'APROVADO')} fechar={() => setCriandoLote(false)} onCriou={async () => { setCriandoLote(false); await recarregar(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Títulos
// ---------------------------------------------------------------------------

function ListaTitulos({ titulos, carregando, onMudou }: { titulos: TituloPagarApi[]; carregando: boolean; onMudou: () => Promise<void> }) {
  const navigate = useNavigate();
  const [acao, setAcao] = useState<null | { tipo: 'devolver' | 'bloquear' | 'cancelar' | 'reabrir' | 'pagar' | 'conciliar'; titulo: TituloPagarApi }>(null);
  const [ocupado, setOcupado] = useState(false);

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      setAcao(null);
      await onMudou();
      toast.sucesso(ok);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const colunas: Coluna<TituloPagarApi>[] = [
    {
      chave: 'descricao',
      titulo: 'Título',
      celular: 'titulo',
      render: (t) => (
        <span className="inline-flex flex-wrap items-center gap-[6px]">
          {t.descricao}
          {t.urgente && <span className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>Urgente</span>}
          {t.fornecedor.alertaProximoPagamento && (
            <span className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }} title="Primeiro pagamento após alteração bancária — confira os dados">
              Alteração bancária recente
            </span>
          )}
          {t.origemReembolso && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/titulares/${t.origemReembolso!.titularId}`); }}
              className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold"
              style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}
              title={`Desembolso do Reembolso Parcelado — contrato ${t.origemReembolso.contratoNumero}. Clique para abrir a ficha do cliente.`}
            >
              Reembolso · {t.origemReembolso.titularNome} ↗
            </button>
          )}
        </span>
      ),
    },
    {
      chave: 'contexto',
      titulo: 'Fornecedor · contexto',
      celular: 'subtitulo',
      render: (t) => (
        <div className="flex flex-col gap-[2px]">
          <span>
            <b style={{ color: 'var(--text-primary)' }}>{t.fornecedor.nome}</b> · {t.entidade.nome} · {t.natureza.codigo} {t.natureza.nome}{t.centro ? ` · ${t.centro.nome}` : ''}
            {' '}· responsável econômico: {ROTULO_RESPONSAVEL_ECONOMICO[t.responsavelEconomico] ?? t.responsavelEconomico}
            {t.documentos.length > 0 && ` · ${t.documentos.length} documento(s)`}
          </span>
          {t.motivoDevolucao && <span style={{ color: 'var(--warn-ink)' }}>Devolvido: {t.motivoDevolucao}</span>}
          {t.motivoBloqueio && <span style={{ color: 'var(--danger-fg)' }}>Bloqueado: {t.motivoBloqueio}</span>}
          {t.pagamentos.map((p) => (
            <span key={p.id} style={{ color: 'var(--text-muted)' }}>
              Pago em {dataBR(p.dataEfetiva)} — {reais(p.valorEfetivo)}{p.identificador ? ` · id ${p.identificador}` : ''} · comprovante: {p.comprovanteNome ?? '—'}
              {p.conciliacao ? ` · conciliação: ${rotuloStatus(p.conciliacao.status)} em ${dataBR(p.conciliacao.dataSaida)}` : ' · aguardando conciliação'}
            </span>
          ))}
        </div>
      ),
    },
    { chave: 'status', titulo: 'Situação', celular: 'campo', render: (t) => <Chip status={t.status} /> },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      celular: 'campo',
      classe: 'tabular-nums',
      render: (t) => (
        <>
          {dataBR(t.vencimento)}
          {t.dataProgramada && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>programado {dataBR(t.dataProgramada)}</div>}
        </>
      ),
    },
    { chave: 'valor', titulo: 'Valor', alinhar: 'right', classe: 'tabular-nums font-semibold', celular: 'destaque', render: (t) => reais(t.valor) },
  ];

  return (
    <div className="flex flex-col gap-[8px]">
      <Tabela
        colunas={colunas}
        linhas={titulos}
        chave={(t) => t.id}
        carregando={carregando}
        vazio={<>Nenhum título neste momento do fluxo. Crie uma despesa em "+ Nova despesa".</>}
        larguraMinima={960}
        acoes={(t) => (
          <>
            {['SOLICITADO', 'EM_VALIDACAO'].includes(t.status) && (
              <>
                <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => rodar(() => financeiroService.validarTitulo(t.id, 'validar'), 'Validado — enviado à alçada na Central de Aprovações.')}>Validar</Botao>
                <Botao tamanho="sm" disabled={ocupado} onClick={() => setAcao({ tipo: 'devolver', titulo: t })}>Devolver</Botao>
                <Botao tamanho="sm" disabled={ocupado} onClick={() => setAcao({ tipo: 'bloquear', titulo: t })}>Bloquear</Botao>
              </>
            )}
            {t.status === 'BLOQUEADO' && (
              <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => rodar(() => financeiroService.validarTitulo(t.id, 'validar'), 'Liberado da análise — enviado à alçada.')}>Liberar e validar</Botao>
            )}
            {t.status === 'DEVOLVIDO' && (
              <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => rodar(() => financeiroService.reenviarTitulo(t.id, {}), 'Reenviado para validação.')}>Reenviar</Botao>
            )}
            {['ENVIADO_BPO', 'AGUARDANDO_CORA', 'PROGRAMADO'].includes(t.status) && (
              <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => setAcao({ tipo: 'pagar', titulo: t })}>Registrar pagamento</Botao>
            )}
            {t.status === 'PAGO' && t.pagamentos.some((p) => !p.conciliacao) && (
              <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => setAcao({ tipo: 'conciliar', titulo: t })}>Conciliar</Botao>
            )}
            {['RASCUNHO', 'SOLICITADO', 'EM_VALIDACAO', 'DEVOLVIDO', 'BLOQUEADO'].includes(t.status) && (
              <Botao tamanho="sm" variante="perigo" disabled={ocupado} onClick={() => setAcao({ tipo: 'cancelar', titulo: t })}>Cancelar</Botao>
            )}
            {['APROVADO', 'PROGRAMADO', 'ENVIADO_BPO', 'AGUARDANDO_CORA', 'PAGO'].includes(t.status) && (
              <Botao tamanho="sm" disabled={ocupado} onClick={() => setAcao({ tipo: 'reabrir', titulo: t })}>Solicitar reabertura</Botao>
            )}
          </>
        )}
      />

      {acao && ['devolver', 'bloquear', 'cancelar', 'reabrir'].includes(acao.tipo) && (
        <ModalMotivo
          titulo={{ devolver: 'Devolver para ajuste', bloquear: 'Bloquear para análise', cancelar: 'Cancelar título', reabrir: 'Solicitar reabertura' }[acao.tipo as 'devolver']}
          aviso={{
            devolver: 'Isso vai devolver o título ao solicitante com o motivo abaixo — a trilha do caso continua a mesma.',
            bloquear: 'Isso vai bloquear o título (suspeita de duplicidade, fraude ou divergência) — ele não entra em lote até decisão.',
            cancelar: 'Isso vai cancelar o título. O registro fica preservado no histórico (nada é apagado).',
            reabrir: 'Isso vai pedir autorização do Diretor Financeiro para reabrir um registro em estado avançado — a aprovação anterior perde validade.',
          }[acao.tipo as 'devolver']}
          ocupado={ocupado}
          fechar={() => setAcao(null)}
          confirmar={(motivo) => {
            const t = acao.titulo;
            if (acao.tipo === 'devolver') void rodar(() => financeiroService.validarTitulo(t.id, 'devolver', motivo), 'Devolvido ao solicitante.');
            if (acao.tipo === 'bloquear') void rodar(() => financeiroService.validarTitulo(t.id, 'bloquear', motivo), 'Bloqueado para análise.');
            if (acao.tipo === 'cancelar') void rodar(() => financeiroService.cancelarTitulo(t.id, motivo), 'Título cancelado (histórico preservado).');
            if (acao.tipo === 'reabrir') void rodar(() => financeiroService.solicitarReabertura(t.id, motivo), 'Reabertura solicitada — decisão na Central de Aprovações.');
          }}
        />
      )}

      {acao?.tipo === 'pagar' && (
        <ModalPagamento titulo={acao.titulo} ocupado={ocupado} fechar={() => setAcao(null)}
          confirmar={(dto) => rodar(() => financeiroService.registrarPagamento(acao.titulo.id, dto), 'Pagamento registrado — título Pago, aguardando conciliação.')} />
      )}
      {acao?.tipo === 'conciliar' && (
        <ModalConciliacao titulo={acao.titulo} ocupado={ocupado} fechar={() => setAcao(null)}
          confirmar={(pagamentoId, dto) => rodar(() => financeiroService.conciliar(pagamentoId, dto), 'Conciliação registrada.')} />
      )}
    </div>
  );
}

function ModalMotivo({ titulo, aviso, ocupado, fechar, confirmar }: { titulo: string; aviso: string; ocupado: boolean; fechar: () => void; confirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  return (
    <Modal open onClose={fechar} title={titulo}>
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{aviso}</div>
        <textarea className={inputCls} style={{ ...inputStyle, height: 'auto' }} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (registrado na trilha e na auditoria)" />
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Voltar</Botao>
          <Botao variante="primaria" disabled={ocupado || motivo.trim().length < 3} onClick={() => confirmar(motivo.trim())}>Confirmar</Botao>
        </div>
      </div>
    </Modal>
  );
}

function ModalPagamento({ titulo, ocupado, fechar, confirmar }: { titulo: TituloPagarApi; ocupado: boolean; fechar: () => void; confirmar: (dto: { dataEfetiva: string; valorEfetivo: number; identificador?: string; comprovanteNome: string; divergencia?: string }) => void }) {
  const [data, setData] = useState(hojeBrasilISO());
  const [valor, setValor] = useState(mascararDinheiro(String(titulo.valor)));
  const [identificador, setIdentificador] = useState('');
  const [comprovante, setComprovante] = useState('');
  return (
    <Modal open onClose={fechar} title="Registrar pagamento executado">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Marca o título como <b>Pago</b> — exige o comprovante. A conciliação com o extrato é um passo separado.
        </div>
        <label className={lblCls}>Data efetiva
          <input type="date" className={inputCls} style={inputStyle} value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className={lblCls}>Valor efetivo (R$) — informe juros/multa/desconto se houver
          <input className={inputCls} style={inputStyle} inputMode="numeric" value={valor} onChange={(e) => setValor(mascararDinheiro(e.target.value))} /></label>
        <label className={lblCls}>Identificador bancário (opcional)
          <input className={inputCls} style={inputStyle} value={identificador} onChange={(e) => setIdentificador(e.target.value)} /></label>
        <label className={lblCls}>Comprovante (nome do arquivo/registro) — obrigatório
          <input className={inputCls} style={inputStyle} value={comprovante} onChange={(e) => setComprovante(e.target.value)} placeholder="ex.: comprovante-pix-2026-08-03.pdf" /></label>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Voltar</Botao>
          <Botao variante="primaria" disabled={ocupado || !comprovante.trim() || dinheiroParaCentavos(valor) <= 0}
            onClick={() => confirmar({ dataEfetiva: data, valorEfetivo: dinheiroParaCentavos(valor), identificador: identificador || undefined, comprovanteNome: comprovante.trim() })}>
            Registrar como Pago
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

function ModalConciliacao({ titulo, ocupado, fechar, confirmar }: { titulo: TituloPagarApi; ocupado: boolean; fechar: () => void; confirmar: (pagamentoId: string, dto: { dataSaida: string; valorExtrato: number; observacao?: string }) => void }) {
  const pagamento = titulo.pagamentos.find((p) => !p.conciliacao);
  const [data, setData] = useState(hojeBrasilISO());
  const [valor, setValor] = useState(pagamento ? mascararDinheiro(String(pagamento.valorEfetivo)) : '');
  const [obs, setObs] = useState('');
  if (!pagamento) return null;
  return (
    <Modal open onClose={fechar} title="Conciliar com o extrato">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Confirme a saída no extrato do banco. Se o valor do extrato divergir do pago ({reais(pagamento.valorEfetivo)}), a conciliação fica <b>Divergente</b> para tratamento.
        </div>
        <label className={lblCls}>Data da saída no extrato
          <input type="date" className={inputCls} style={inputStyle} value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className={lblCls}>Valor no extrato (R$)
          <input className={inputCls} style={inputStyle} inputMode="numeric" value={valor} onChange={(e) => setValor(mascararDinheiro(e.target.value))} /></label>
        <label className={lblCls}>Observação (opcional)
          <input className={inputCls} style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Voltar</Botao>
          <Botao variante="primaria" disabled={ocupado || dinheiroParaCentavos(valor) <= 0}
            onClick={() => confirmar(pagamento.id, { dataSaida: data, valorExtrato: dinheiroParaCentavos(valor), observacao: obs || undefined })}>
            Confirmar conciliação
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Nova despesa (dimensões condicionais por natureza)
// ---------------------------------------------------------------------------

// Categorias que podem entrar num título: ativas e de saída (receita fica no
// plano, mas não aparece aqui — doc 02 §18.6).
function categoriasDeSaida(config: ConfiguracaoFinanceiro) {
  return config.naturezas.filter((n) => n.ativo && n.saida && n.grupoId);
}
function gruposComSaida(config: ConfiguracaoFinanceiro) {
  const ids = new Set(categoriasDeSaida(config).map((n) => n.grupoId));
  return config.grupos.filter((g) => g.ativo && ids.has(g.id));
}

// Grupo → categoria em dois selects (o operador escolhe "03. Custos" e só então
// vê 3.01…3.05), como o Luís pediu em 05/10.
function SeletorCategoria({ config, naturezaId, onChange, disabled }: { config: ConfiguracaoFinanceiro; naturezaId: string; onChange: (id: string) => void; disabled?: boolean }) {
  const grupos = gruposComSaida(config);
  const atual = config.naturezas.find((n) => n.id === naturezaId);
  const [grupoId, setGrupoId] = useState(atual?.grupoId ?? '');
  const categorias = categoriasDeSaida(config).filter((n) => n.grupoId === grupoId);
  return (
    <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
      <label className={lblCls}>Grupo (plano do financeiro)
        <select className={inputCls} style={inputStyle} value={grupoId} disabled={disabled} onChange={(e) => { setGrupoId(e.target.value); onChange(''); }}>
          <option value="">Selecione…</option>
          {grupos.map((g) => <option key={g.id} value={g.id}>{g.codigo}. {g.nome}</option>)}
        </select></label>
      <label className={lblCls}>Categoria (o que está sendo pago)
        <select className={inputCls} style={inputStyle} value={naturezaId} disabled={disabled || !grupoId} onChange={(e) => onChange(e.target.value)}>
          <option value="">{grupoId ? 'Selecione…' : 'Escolha o grupo'}</option>
          {categorias.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.nome}{n.especial ? ' — aprovação da Diretoria' : ''}</option>)}
        </select></label>
    </div>
  );
}

// Fornecedor escolhido no título, com cadastro rápido no próprio modal (nome +
// CPF/CNPJ + chave PIX) — o operador não sai da tela para cadastrar (05/10).
function SeletorFornecedor({ fornecedorId, onChange, rotulo }: { fornecedorId: string; onChange: (id: string) => void; rotulo: string }) {
  const qc = useQueryClient();
  const fornecedores = useQuery({ queryKey: ['fin-fornecedores'], queryFn: () => financeiroService.fornecedores() });
  const [novo, setNovo] = useState(false);
  const [nf, setNf] = useState({ nome: '', cpfCnpj: '', chavePix: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function cadastrar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await financeiroService.criarFornecedor({ nome: nf.nome.trim(), cpfCnpj: nf.cpfCnpj.replace(/\D/g, ''), chavePix: nf.chavePix.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ['fin-fornecedores'] });
      onChange(r.id);
      setNovo(false);
      setNf({ nome: '', cpfCnpj: '', chavePix: '' });
      toast.sucesso('Fornecedor cadastrado e selecionado — a chave PIX vai para aprovação da Diretoria antes do pagamento sair.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }
  return (
    <div className="flex flex-col gap-[6px]">
      <label className={lblCls}>{rotulo}
        <div className="flex gap-[6px]">
          <select className={inputCls} style={inputStyle} value={fornecedorId} onChange={(e) => onChange(e.target.value)}>
            <option value="">Selecione…</option>
            {(fornecedores.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.nome} ({rotuloStatus(x.status)})</option>)}
          </select>
          <Botao className="flex-none" onClick={() => setNovo((v) => !v)}>{novo ? 'Cancelar' : '+ Cadastrar'}</Botao>
        </div>
      </label>
      {novo && (
        <div className="rounded-[12px] p-[10px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
            <label className={`${lblCls} text-[11.5px]`}>Nome
              <input className={inputCls} style={inputStyleClaro} value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} placeholder="ex.: Auto Center X" /></label>
            <label className={`${lblCls} text-[11.5px]`}>CPF/CNPJ
              <input className={inputCls} style={inputStyleClaro} inputMode="numeric" value={nf.cpfCnpj} onChange={(e) => setNf({ ...nf, cpfCnpj: mascararCpfCnpj(e.target.value) })} /></label>
            <label className={`${lblCls} text-[11.5px]`}>Chave PIX
              <input className={inputCls} style={inputStyleClaro} value={nf.chavePix} onChange={(e) => setNf({ ...nf, chavePix: e.target.value })} placeholder="CPF/CNPJ, e-mail, telefone ou aleatória" /></label>
          </div>
          {erro && <div className="mt-[6px] text-[12px]" style={{ color: 'var(--danger-fg)' }}>{erro}</div>}
          <div className="mt-[8px] flex flex-wrap items-center justify-between gap-[8px]">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>CPF/CNPJ repetido é recusado — o sistema aponta o cadastro que já existe.</span>
            <Botao tamanho="sm" variante="primaria" carregando={salvando} disabled={nf.nome.trim().length < 2 || nf.cpfCnpj.replace(/\D/g, '').length < 11} onClick={cadastrar}>Salvar e selecionar</Botao>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalNovaDespesa({ config, fechar, onCriou }: { config: ConfiguracaoFinanceiro; fechar: () => void; onCriou: () => Promise<void> }) {
  const [f, setF] = useState({
    entidadeId: config.entidades[0]?.id ?? '', fornecedorId: '', descricao: '', valor: '', vencimento: '',
    competencia: '', naturezaId: '', centroCustoAreaId: '',
    responsavelEconomico: 'AZIT', formaPagamento: 'pix', ativoId: '', urgente: false, justificativaUrgencia: '',
    justificativaNatureza: '', documentoNome: '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const natureza = config.naturezas.find((n) => n.id === f.naturezaId);

  async function criar() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await financeiroService.criarTitulo({
        entidadeId: f.entidadeId,
        fornecedorId: f.fornecedorId,
        descricao: f.descricao.trim(),
        valor: dinheiroParaCentavos(f.valor),
        vencimento: f.vencimento,
        competencia: f.competencia || undefined,
        naturezaId: f.naturezaId,
        centroCustoAreaId: f.centroCustoAreaId || undefined,
        responsavelEconomico: f.responsavelEconomico,
        formaPagamento: f.formaPagamento,
        ativoId: f.ativoId || undefined,
        urgente: f.urgente,
        justificativaUrgencia: f.justificativaUrgencia || undefined,
        justificativaNatureza: f.justificativaNatureza || undefined,
        documentoNome: f.documentoNome || undefined,
      });
      await onCriou();
      toast.sucesso(r.status === 'BLOQUEADO' ? 'Despesa criada, porém BLOQUEADA por possível duplicidade — analise na fila.' : 'Despesa criada — siga com a validação.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const set = (campo: string) => (e: { target: { value: string } }) => setF({ ...f, [campo]: e.target.value });

  return (
    <Modal open onClose={fechar} title="Nova despesa / título a pagar">
      <div className="flex max-h-[65vh] flex-col gap-[8px] overflow-y-auto pr-[4px]">
        <label className={lblCls}>Entidade legal (CNPJ que assume a obrigação)
          <select className={inputCls} style={inputStyle} value={f.entidadeId} onChange={set('entidadeId')}>
            {config.entidades.map((e) => <option key={e.id} value={e.id}>{e.razaoSocial}{e.unidadeNegocio ? ` — ${e.unidadeNegocio}` : ''}</option>)}
          </select></label>
        <SeletorFornecedor rotulo="Fornecedor (precisa estar ativo para pagar)" fornecedorId={f.fornecedorId} onChange={(id) => setF({ ...f, fornecedorId: id })} />
        <label className={lblCls}>Descrição (objeto, ativo e fornecedor quando aplicável)
          <input className={inputCls} style={inputStyle} value={f.descricao} onChange={set('descricao')} placeholder="ex.: Troca de pneus — HB20S ABC1D23 — Auto Center X" /></label>
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
          <label className={lblCls}>Valor (R$)
            <input className={inputCls} style={inputStyle} inputMode="numeric" value={f.valor} onChange={(e) => setF({ ...f, valor: mascararDinheiro(e.target.value) })} /></label>
          <label className={lblCls}>Vencimento
            <input type="date" className={inputCls} style={inputStyle} value={f.vencimento} onChange={set('vencimento')} /></label>
          <label className={lblCls}>Competência (opcional)
            <input className={inputCls} style={inputStyle} value={f.competencia} onChange={set('competencia')} placeholder="ex.: 08/2026" /></label>
          <label className={lblCls}>Forma de pagamento
            <select className={inputCls} style={inputStyle} value={f.formaPagamento} onChange={set('formaPagamento')}>
              <option value="pix">PIX</option><option value="boleto">Boleto</option><option value="ted">TED</option><option value="cartao">Cartão (forma, não natureza)</option>
            </select></label>
        </div>
        <SeletorCategoria config={config} naturezaId={f.naturezaId} onChange={(id) => setF({ ...f, naturezaId: id })} />
        {natureza?.exigeAtivo && (
          <label className={lblCls} style={{ color: 'var(--warn-ink)' }}>Veículo/ativo (obrigatório nesta categoria) — informe o código do ativo
            <input className={inputCls} style={inputStyle} value={f.ativoId} onChange={set('ativoId')} placeholder="código do ativo (da tela Estoque de ativos)" /></label>
        )}
        {natureza?.exigeJustificativa && (
          <label className={lblCls} style={{ color: 'var(--warn-ink)' }}>Justificativa (categoria excepcional)
            <input className={inputCls} style={inputStyle} value={f.justificativaNatureza} onChange={set('justificativaNatureza')} /></label>
        )}
        <label className={lblCls}>Centro de custo (opcional — área responsável)
          <select className={inputCls} style={inputStyle} value={f.centroCustoAreaId} onChange={set('centroCustoAreaId')}>
            <option value="">Sem centro de custo</option>
            {config.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select></label>
        <label className={lblCls}>Responsável econômico (quem arca com o valor)
          <select className={inputCls} style={inputStyle} value={f.responsavelEconomico} onChange={set('responsavelEconomico')}>
            <option value="AZIT">Azit Move</option><option value="INVESTIDOR">Investidor</option><option value="CLIENTE">Cliente</option><option value="OUTRA_ENTIDADE">Outra entidade</option>
          </select></label>
        <label className={lblCls}>Documento (nome do arquivo — nota fiscal, boleto, guia…)
          <input className={inputCls} style={inputStyle} value={f.documentoNome} onChange={set('documentoNome')} placeholder="ex.: nf-1234-autocentro.pdf" /></label>
        <label className="flex items-center gap-[6px] text-[12.5px]">
          <input type="checkbox" checked={f.urgente} onChange={(e) => setF({ ...f, urgente: e.target.checked })} />
          Urgente (dispensa o corte das 12h — exige justificativa e aprovação da Diretoria)
        </label>
        {f.urgente && (
          <input className={inputCls} style={inputStyle} value={f.justificativaUrgencia} onChange={set('justificativaUrgencia')} placeholder="Justificativa objetiva da urgência" />
        )}
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primaria" disabled={ocupado || !f.fornecedorId || !f.naturezaId || !f.descricao.trim() || dinheiroParaCentavos(f.valor) <= 0 || !f.vencimento}
            onClick={criar}>{ocupado ? 'Criando…' : 'Criar despesa'}</Botao>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Orçamentos — cada solicitação carrega suas propostas (lista aninhada), por
// isso mantém a estrutura de cartão em vez da <Tabela>.
// ---------------------------------------------------------------------------

function ListaOrcamentos({ orcamentos, carregando, config, onMudou }: { orcamentos: OrcamentoApi[]; carregando: boolean; config?: ConfiguracaoFinanceiro; onMudou: () => Promise<void> }) {
  const [convertendo, setConvertendo] = useState<OrcamentoApi | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try { await fn(); setConvertendo(null); await onMudou(); toast.sucesso(ok); }
    catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  if (carregando) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  if (orcamentos.length === 0) return <div className={card} style={cardStyle}><span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Nenhuma solicitação de orçamento. O orçamento controla a escolha ANTES da obrigação existir.</span></div>;

  return (
    <div className="flex flex-col gap-[8px]">
      {orcamentos.map((o) => (
        <div key={o.id} className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <span className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{o.descricao}</span>
              <Chip status={o.status} />
            </div>
            {o.status === 'APROVADO' && (
              <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => setConvertendo(o)}>Converter em despesa</Botao>
            )}
          </div>
          <div className="mt-[8px] grid grid-cols-1 gap-[6px] sm:grid-cols-2">
            {o.propostas.map((p) => (
              <div key={p.id} className="rounded-[12px] p-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: p.selecionado ? '2px solid var(--text-primary)' : '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <div className="flex items-center justify-between gap-[8px]">
                  <b>{p.fornecedor ?? 'Fornecedor'}</b>
                  <span className="font-bold tabular-nums">{reais(p.valor)}</span>
                </div>
                <div style={{ color: 'var(--text-muted)' }}>{[p.prazo && `prazo ${p.prazo}`, p.garantia && `garantia ${p.garantia}`, p.condicao].filter(Boolean).join(' · ') || '—'}</div>
                {o.status === 'EM_COTACAO' && (
                  <Botao tamanho="sm" className="mt-[6px]" disabled={ocupado}
                    onClick={() => rodar(() => financeiroService.submeterOrcamento(o.id, p.id), 'Proposta selecionada — decisão na Central de Aprovações.')}>
                    Selecionar e submeter à alçada
                  </Botao>
                )}
                {p.selecionado && <div className="mt-[4px] text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>Proposta escolhida{p.motivoSelecao ? ` — ${p.motivoSelecao}` : ''}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {convertendo && config && (
        <ModalConverterOrcamento orcamento={convertendo} config={config} ocupado={ocupado} fechar={() => setConvertendo(null)}
          confirmar={(dto) => rodar(() => financeiroService.converterOrcamento(convertendo.id, dto), 'Orçamento convertido em despesa — siga na aba Títulos.')} />
      )}
    </div>
  );
}

function ModalConverterOrcamento({ orcamento, config, ocupado, fechar, confirmar }: { orcamento: OrcamentoApi; config: ConfiguracaoFinanceiro; ocupado: boolean; fechar: () => void; confirmar: (dto: { fornecedorId: string; vencimento: string; naturezaId: string; centroCustoAreaId?: string }) => void }) {
  const selecionada = orcamento.propostas.find((p) => p.selecionado);
  const [f, setF] = useState({ fornecedorId: selecionada?.fornecedorId ?? '', vencimento: '', naturezaId: '', centroCustoAreaId: '' });
  return (
    <Modal open onClose={fechar} title="Converter orçamento em despesa">
      <div className="flex flex-col gap-[8px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          A despesa nasce com o valor da proposta escolhida ({selecionada ? reais(selecionada.valor) : '—'}) e mantém o vínculo com a decisão do orçamento.
        </div>
        <SeletorFornecedor rotulo="Fornecedor (cadastrado e ativo)" fornecedorId={f.fornecedorId} onChange={(id) => setF({ ...f, fornecedorId: id })} />
        <label className={lblCls}>Vencimento
          <input type="date" className={inputCls} style={inputStyle} value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></label>
        <SeletorCategoria config={config} naturezaId={f.naturezaId} onChange={(id) => setF({ ...f, naturezaId: id })} />
        <label className={lblCls}>Centro de custo
          <select className={inputCls} style={inputStyle} value={f.centroCustoAreaId} onChange={(e) => setF({ ...f, centroCustoAreaId: e.target.value })}>
            <option value="">Sem centro de custo</option>
            {config.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select></label>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Voltar</Botao>
          <Botao variante="primaria" disabled={ocupado || !f.fornecedorId || !f.naturezaId || !f.vencimento} onClick={() => confirmar({ ...f, centroCustoAreaId: f.centroCustoAreaId || undefined })}>Converter</Botao>
        </div>
      </div>
    </Modal>
  );
}

function ModalNovoOrcamento({ config, fechar, onCriou }: { config: ConfiguracaoFinanceiro; fechar: () => void; onCriou: () => Promise<void> }) {
  const [f, setF] = useState({ entidadeId: config.entidades[0]?.id ?? '', descricao: '', urgencia: 'NORMAL' });
  const [propostas, setPropostas] = useState([{ nomeFornecedor: '', valor: '', prazo: '', condicao: '' }]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setErro(null);
    setOcupado(true);
    try {
      await financeiroService.criarOrcamento({
        entidadeId: f.entidadeId,
        descricao: f.descricao.trim(),
        urgencia: f.urgencia,
        propostas: propostas.filter((p) => p.nomeFornecedor.trim() && dinheiroParaCentavos(p.valor) > 0)
          .map((p) => ({ nomeFornecedor: p.nomeFornecedor.trim(), valor: dinheiroParaCentavos(p.valor), prazo: p.prazo || undefined, condicao: p.condicao || undefined })),
      });
      await onCriou();
      toast.sucesso('Solicitação de orçamento criada — selecione a proposta vencedora para submeter à alçada.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <Modal open onClose={fechar} title="Solicitar orçamento (cotação)">
      <div className="flex max-h-[65vh] flex-col gap-[8px] overflow-y-auto pr-[4px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Compare de preferência 2 ou 3 fornecedores. Orçamento aprovado NÃO é conta a pagar — a conversão em despesa é um passo separado.
        </div>
        <label className={lblCls}>Entidade legal
          <select className={inputCls} style={inputStyle} value={f.entidadeId} onChange={(e) => setF({ ...f, entidadeId: e.target.value })}>
            {config.entidades.map((e2) => <option key={e2.id} value={e2.id}>{e2.razaoSocial}</option>)}
          </select></label>
        <label className={lblCls}>O que precisa ser comprado/contratado
          <input className={inputCls} style={inputStyle} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
        <div className="text-[12px] font-bold">Propostas</div>
        {propostas.map((p, i) => (
          <div key={i} className="grid grid-cols-1 gap-[6px] rounded-[12px] p-[8px] sm:grid-cols-2" style={{ background: 'var(--surface-input)' }}>
            <input className={inputCls} style={inputStyleClaro} placeholder="Fornecedor" value={p.nomeFornecedor} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, nomeFornecedor: e.target.value } : x)))} />
            <input className={inputCls} style={inputStyleClaro} placeholder="Valor (R$)" inputMode="numeric" value={p.valor} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, valor: mascararDinheiro(e.target.value) } : x)))} />
            <input className={inputCls} style={inputStyleClaro} placeholder="Prazo" value={p.prazo} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, prazo: e.target.value } : x)))} />
            <input className={inputCls} style={inputStyleClaro} placeholder="Condição de pagamento" value={p.condicao} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, condicao: e.target.value } : x)))} />
          </div>
        ))}
        <div><Botao tamanho="sm" onClick={() => setPropostas([...propostas, { nomeFornecedor: '', valor: '', prazo: '', condicao: '' }])}>+ Adicionar proposta</Botao></div>
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primaria" disabled={ocupado || !f.descricao.trim()} onClick={criar}>Criar solicitação</Botao>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Lotes — cada lote lista seus títulos (lista aninhada), por isso mantém a
// estrutura de cartão em vez da <Tabela>.
// ---------------------------------------------------------------------------

function ListaLotes({ lotes, carregando, onMudou }: { lotes: LotePagamentoApi[]; carregando: boolean; onMudou: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try { await fn(); await onMudou(); toast.sucesso(ok); }
    catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }
  if (carregando) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  if (lotes.length === 0) return <div className={card} style={cardStyle}><span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Nenhum lote. Um lote agrupa títulos aprovados de UMA entidade e UMA conta para envio ao BPO.</span></div>;
  return (
    <div className="flex flex-col gap-[8px]">
      {lotes.map((l) => (
        <div key={l.id} className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{l.entidade}</span>
                <Chip status={l.status} deLote />
                {l.urgente && <span className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>Urgente</span>}
              </div>
              <div className="mt-[2px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                {l.conta} · programado {dataBR(l.dataProgramada)} · versão {l.versao} · {l.totalItens} título(s) · {reais(l.totalValor)}
                {l.enviadoEm && ` · enviado ${dataBR(l.enviadoEm)}`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-[6px]">
              <Botao tamanho="sm" disabled={ocupado} onClick={() => financeiroService.baixarResumoLote(l.id)}>Baixar resumo (BPO)</Botao>
              {l.status === 'APROVADO' && <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => rodar(() => financeiroService.eventoLote(l.id, 'enviado_bpo'), 'Envio ao BPO registrado.')}>Marcar enviado ao BPO</Botao>}
              {l.status === 'ENVIADO_BPO' && <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => rodar(() => financeiroService.eventoLote(l.id, 'cadastrado_cora'), 'Cadastro no banco registrado — aguardando aprovação do Diretor no aplicativo.')}>Marcar cadastrado no banco</Botao>}
              {l.status === 'AGUARDANDO_APROVACAO_BANCO' && <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => rodar(() => financeiroService.eventoLote(l.id, 'aprovado_banco'), 'Aprovação bancária registrada — registre os pagamentos nos títulos.')}>Marcar aprovado no banco</Botao>}
              {l.status === 'EM_PREPARACAO' && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Aguardando liberação na Central de Aprovações</span>}
              {/* Auditoria 15/09 (Bloco D): estados finais do lote ficavam sem
                  ação NEM explicação — o operador não sabia a continuação. */}
              {['APROVADO_BANCO', 'PARCIALMENTE_PAGO'].includes(l.status) && (
                <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Banco aprovou — registre cada pagamento na aba <b>Títulos</b> ("Registrar pagamento") e depois concilie.
                </span>
              )}
              {l.status === 'PAGO' && (
                <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Lote pago — a conciliação com o extrato acontece título a título na aba <b>Títulos</b>.
                </span>
              )}
            </div>
          </div>
          <div className="mt-[8px] flex flex-col gap-[4px]">
            {l.titulos.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-[6px] rounded-[10px] px-[10px] py-[6px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                <span>{t.fornecedor} — {t.descricao}{t.alertaBancario && <b style={{ color: 'var(--warn-ink)' }}> · conferir dados bancários (alteração recente)</b>}</span>
                <span className="flex items-center gap-[8px]"><Chip status={t.status} /><b className="tabular-nums">{reais(t.valor)}</b></span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModalNovoLote({ config, titulos, fechar, onCriou }: { config: ConfiguracaoFinanceiro; titulos: TituloPagarApi[]; fechar: () => void; onCriou: () => Promise<void> }) {
  const [entidadeId, setEntidadeId] = useState(config.entidades[0]?.id ?? '');
  const [contaId, setContaId] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entidade = config.entidades.find((e) => e.id === entidadeId);
  const daEntidade = titulos.filter((t) => t.entidade.id === entidadeId);
  const total = daEntidade.filter((t) => selecionados.includes(t.id)).reduce((s, t) => s + t.valor, 0);

  async function criar() {
    setErro(null);
    setOcupado(true);
    try {
      await financeiroService.criarLote({ entidadeId, contaBancariaId: contaId, tituloIds: selecionados });
      await onCriou();
      toast.sucesso('Lote formado — liberação do Diretor na Central de Aprovações.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <Modal open onClose={fechar} title="Formar lote de pagamento">
      <div className="flex max-h-[65vh] flex-col gap-[8px] overflow-y-auto pr-[4px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Um lote contém títulos aprovados de UMA entidade e sai de UMA conta. Total conferível antes da liberação do Diretor.
        </div>
        <label className={lblCls}>Entidade legal
          <select className={inputCls} style={inputStyle} value={entidadeId} onChange={(e) => { setEntidadeId(e.target.value); setContaId(''); setSelecionados([]); }}>
            {config.entidades.map((e2) => <option key={e2.id} value={e2.id}>{e2.razaoSocial}</option>)}
          </select></label>
        <label className={lblCls}>Conta pagadora (da própria entidade)
          <select className={inputCls} style={inputStyle} value={contaId} onChange={(e) => setContaId(e.target.value)}>
            <option value="">Selecione…</option>
            {(entidade?.contas ?? []).map((c) => <option key={c.id} value={c.id}>{c.banco}{c.agencia ? ` ag ${c.agencia}` : ''}{c.conta ? ` c/c ${c.conta}` : ''}</option>)}
          </select></label>
        <div className="text-[12px] font-bold">Títulos aprovados desta entidade</div>
        {daEntidade.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum título aprovado para esta entidade.</div>}
        {daEntidade.map((t) => (
          <label key={t.id} className="flex items-center justify-between gap-[8px] rounded-[10px] px-[10px] py-[7px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
            <span className="flex items-center gap-[8px]">
              <input type="checkbox" checked={selecionados.includes(t.id)} onChange={(e) => setSelecionados(e.target.checked ? [...selecionados, t.id] : selecionados.filter((x) => x !== t.id))} />
              {t.fornecedor.nome} — {t.descricao} (vence {dataBR(t.vencimento)})
            </span>
            <b className="tabular-nums">{reais(t.valor)}</b>
          </label>
        ))}
        <div className="flex items-center justify-between rounded-[10px] px-[10px] py-[8px] text-[13px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
          <span>Total do lote ({selecionados.length} título(s))</span>
          <b className="tabular-nums">{reais(total)}</b>
        </div>
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primaria" disabled={ocupado || !contaId || selecionados.length === 0} onClick={criar}>Formar lote e pedir liberação</Botao>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Por categoria (doc 02 §18.6): o mês pelo plano do Manda — grupo → categoria,
// previsto (em aberto) × pago, pelo vencimento. É o que a operação confere no
// fim do dia e o que o BPO recebe classificado.
// É uma ÁRVORE (grupo expansível → categorias), que a <Tabela> não modela: no
// desktop fica a grade própria; no celular cada grupo vira um cartão empilhado.
// ---------------------------------------------------------------------------

type GrupoQuadro = LinhaCategoria & { categorias: LinhaCategoria[] };

function QuadroCategorias() {
  const [mes, setMes] = useState(hojeBrasilISO().slice(0, 7));
  const quadro = useQuery({ queryKey: ['fin-por-categoria', mes], queryFn: () => financeiroService.porCategoria(mes) });
  const q = quadro.data;
  const th = 'pb-[6px] text-right text-[10.5px] font-semibold uppercase tracking-[0.1em]';
  const td = 'py-[5px] text-right tabular-nums';
  const grupos: GrupoQuadro[] = q
    ? [
        ...q.grupos.filter((g) => g.ativo || g.quantidade > 0),
        ...(q.semGrupo.length > 0
          ? [{ id: 'sem', codigo: '—', nome: 'Sem grupo', ativo: true, saida: true, aberto: q.semGrupo.reduce((a, c) => a + c.aberto, 0), pago: q.semGrupo.reduce((a, c) => a + c.pago, 0), cancelado: 0, quantidade: q.semGrupo.reduce((a, c) => a + c.quantidade, 0), categorias: q.semGrupo }]
          : []),
      ]
    : [];
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap items-end gap-[8px]">
        <label className={lblCls}>Mês (pelo vencimento)
          <input type="month" className={`${inputCls} w-[170px]`} style={inputStyle} value={mes} onChange={(e) => setMes(e.target.value)} /></label>
        {q && (
          <div className="pb-[8px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            {q.total.quantidade} título(s) · em aberto <b style={{ color: 'var(--text-primary)' }}>{reais(q.total.aberto)}</b> · pago <b style={{ color: 'var(--text-primary)' }}>{reais(q.total.pago)}</b>{q.total.cancelado > 0 && <> · cancelado {reais(q.total.cancelado)}</>}
          </div>
        )}
      </div>
      {quadro.isLoading && <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}
      {q && (
        <>
          {/* Celular: um cartão por grupo */}
          <div className="flex flex-col gap-[8px] md:hidden">
            {grupos.map((g) => <GrupoCartao key={g.id} g={g} />)}
            <div className="flex items-center justify-between rounded-card px-[14px] py-[10px] text-[13px] font-bold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <span>Total do mês · {q.total.quantidade}</span>
              <span className="tabular-nums">{reais(q.total.aberto + q.total.pago)}</span>
            </div>
          </div>

          {/* Desktop: a grade em árvore */}
          <div className="hidden overflow-x-auto rounded-card p-[12px] md:block" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead><tr style={{ color: 'var(--text-label)' }}>
                <th className="pb-[6px] text-left text-[10.5px] font-semibold uppercase tracking-[0.1em]">Categoria</th>
                <th className={th}>Títulos</th><th className={th}>Em aberto</th><th className={th}>Pago</th><th className={th}>Total</th>
              </tr></thead>
              <tbody>
                {grupos.map((g) => <GrupoLinhas key={g.id} g={g} td={td} />)}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="py-[7px] font-bold">Total do mês</td>
                  <td className={`${td} font-bold`}>{q.total.quantidade}</td>
                  <td className={`${td} font-bold`}>{reais(q.total.aberto)}</td>
                  <td className={`${td} font-bold`}>{reais(q.total.pago)}</td>
                  <td className={`${td} font-bold`}>{reais(q.total.aberto + q.total.pago)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Cancelados ficam fora dos totais. Categorias de receita ficam no plano, mas não recebem título a pagar. Para incluir ou renomear categoria: Configuração do financeiro.
          </div>
        </>
      )}
    </div>
  );
}

function GrupoLinhas({ g, td }: { g: GrupoQuadro; td: string }) {
  const [aberto, setAberto] = useState(g.quantidade > 0);
  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
        <td className="py-[6px] font-bold">
          <button type="button" className="mr-[6px] inline-flex h-[24px] w-[24px] items-center justify-center text-[11px]" onClick={() => setAberto((v) => !v)} aria-label={aberto ? 'Recolher' : 'Expandir'}>{aberto ? '▾' : '▸'}</button>
          {g.codigo}. {g.nome}
        </td>
        <td className={`${td} font-bold`}>{g.quantidade || '—'}</td>
        <td className={`${td} font-bold`}>{g.aberto ? reais(g.aberto) : '—'}</td>
        <td className={`${td} font-bold`}>{g.pago ? reais(g.pago) : '—'}</td>
        <td className={`${td} font-bold`}>{g.aberto + g.pago ? reais(g.aberto + g.pago) : '—'}</td>
      </tr>
      {aberto && g.categorias.map((c) => (
        <tr key={c.id} style={{ borderTop: '1px solid var(--border-light)', color: c.saida ? 'var(--text-body)' : 'var(--text-muted)' }}>
          <td className="py-[5px] pl-[26px]">{c.codigo} {c.nome}{!c.saida && ' (receita)'}{!c.ativo && ' (inativa)'}</td>
          <td className={td}>{c.quantidade || '—'}</td>
          <td className={td}>{c.aberto ? reais(c.aberto) : '—'}</td>
          <td className={td}>{c.pago ? reais(c.pago) : '—'}</td>
          <td className={td}>{c.aberto + c.pago ? reais(c.aberto + c.pago) : '—'}</td>
        </tr>
      ))}
    </>
  );
}

// Versão de celular do grupo: cabeçalho com total e as categorias empilhadas.
function GrupoCartao({ g }: { g: GrupoQuadro }) {
  const [aberto, setAberto] = useState(g.quantidade > 0);
  return (
    <div className="rounded-card p-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      <button type="button" className="flex w-full items-center justify-between gap-[8px] text-left" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="text-[13.5px] font-semibold">{aberto ? '▾' : '▸'} {g.codigo}. {g.nome}</span>
        <span className="font-display text-[13px] font-semibold tabular-nums">{g.aberto + g.pago ? reais(g.aberto + g.pago) : '—'}</span>
      </button>
      <div className="mt-[6px] grid grid-cols-3 gap-[8px] text-[12px]">
        <div><div className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-label)' }}>Títulos</div><div className="tabular-nums">{g.quantidade || '—'}</div></div>
        <div><div className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-label)' }}>Em aberto</div><div className="tabular-nums">{g.aberto ? reais(g.aberto) : '—'}</div></div>
        <div><div className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-label)' }}>Pago</div><div className="tabular-nums">{g.pago ? reais(g.pago) : '—'}</div></div>
      </div>
      {aberto && g.categorias.length > 0 && (
        <div className="mt-[8px] flex flex-col gap-[4px] pt-[8px] text-[12px]" style={{ borderTop: '1px solid var(--border-light)' }}>
          {g.categorias.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-[8px]" style={{ color: c.saida ? 'var(--text-body)' : 'var(--text-muted)' }}>
              <span>{c.codigo} {c.nome}{!c.saida && ' (receita)'}{!c.ativo && ' (inativa)'}</span>
              <span className="flex-none tabular-nums">{c.aberto + c.pago ? reais(c.aberto + c.pago) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
