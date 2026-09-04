import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  financeiroService,
  TituloPagarApi,
  OrcamentoApi,
  LotePagamentoApi,
  ConfiguracaoFinanceiro,
} from '../services/financeiro.service';
import { rotuloStatus, ROTULO_RESPONSAVEL_ECONOMICO, ROTULO_STATUS_LOTE } from '../lib/rotulos';
import { mascararDinheiro, dinheiroParaCentavos } from '../lib/mascaras';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { hojeLocalISO } from '../lib/datas';
import { mensagemErro } from '../lib/permissoes';

// Contas a Pagar (doc 02 §18) — fila antes de ficha: abas por momento do fluxo,
// ação da etapa sempre visível, modais com contexto. Nada de sigla em tela.

const card = 'rounded-[14px] p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[34px] w-full rounded-[8px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const btn = 'rounded-[8px] px-[12px] py-[7px] text-[12px] font-bold';
const btnP = `${btn} bg-[var(--navy)] text-white disabled:opacity-40`;
const btnS = `${btn} border border-[var(--border)]`;

function reais(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dataBR(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

const COR_STATUS: Record<string, { bg: string; fg: string }> = {
  SOLICITADO: { bg: '#eef4ff', fg: '#1c4587' },
  EM_VALIDACAO: { bg: '#eef4ff', fg: '#1c4587' },
  DEVOLVIDO: { bg: '#fff3d6', fg: '#8a5a00' },
  AGUARDANDO_APROVACAO: { bg: '#fff3d6', fg: '#8a5a00' },
  APROVADO: { bg: '#e5f5ec', fg: '#1c7c4c' },
  PROGRAMADO: { bg: '#e5f5ec', fg: '#1c7c4c' },
  ENVIADO_BPO: { bg: '#eef4ff', fg: '#1c4587' },
  AGUARDANDO_CORA: { bg: '#fff3d6', fg: '#8a5a00' },
  PAGO: { bg: '#e5f5ec', fg: '#1c7c4c' },
  CONCILIADO: { bg: '#e5f5ec', fg: '#1c7c4c' },
  CANCELADO: { bg: '#fdecec', fg: '#a12622' },
  BLOQUEADO: { bg: '#fdecec', fg: '#a12622' },
};

function Chip({ status, deLote }: { status: string; deLote?: boolean }) {
  const c = COR_STATUS[status] ?? { bg: '#f2f3f5', fg: '#5a6472' };
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

export function ContasPagarPage() {
  const qc = useQueryClient();
  const [aba, setAba] = useState<'titulos' | 'orcamentos' | 'lotes'>('titulos');
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

  return (
    <div className="flex flex-col gap-[14px] p-[24px]">
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div>
          <h1 className="font-display text-[20px] font-bold">Contas a pagar</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Do pedido ao extrato: solicitação, validação, aprovação por alçada, lote por entidade,
            envio ao BPO, pagamento com comprovante e conciliação. Pago e Conciliado são etapas diferentes.
          </p>
        </div>
        <div className="flex gap-[8px]">
          <button className={btnS} onClick={() => setCriandoOrcamento(true)}>+ Solicitar orçamento</button>
          <button className={btnP} onClick={() => setCriandoTitulo(true)}>+ Nova despesa</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-[8px]">
        {(
          [
            ['titulos', 'Títulos'],
            ['orcamentos', 'Orçamentos'],
            ['lotes', 'Lotes de pagamento'],
          ] as const
        ).map(([k, rotulo]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className="h-[32px] rounded-[8px] px-[14px] text-[12.5px] font-semibold"
            style={aba === k ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === 'titulos' && (
        <>
          <div className="flex flex-wrap gap-[6px]">
            {MOMENTOS.map((m) => {
              const qtd = m.status.length > 0 ? (titulos.data ?? []).filter((t) => m.status.includes(t.status)).length : (titulos.data ?? []).length;
              return (
                <button
                  key={m.chave}
                  onClick={() => setMomento(m.chave)}
                  className="h-[30px] rounded-full px-[12px] text-[12px] font-semibold"
                  style={momento === m.chave ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                >
                  {m.rotulo} ({qtd})
                </button>
              );
            })}
          </div>
          <ListaTitulos titulos={doMomento} carregando={titulos.isLoading} onMudou={recarregar} />
        </>
      )}

      {aba === 'orcamentos' && (
        <ListaOrcamentos orcamentos={orcamentos.data ?? []} carregando={orcamentos.isLoading} config={config.data} onMudou={recarregar} />
      )}

      {aba === 'lotes' && (
        <>
          <div>
            <button className={btnP} onClick={() => setCriandoLote(true)}>+ Formar lote com títulos aprovados</button>
          </div>
          <ListaLotes lotes={lotes.data ?? []} carregando={lotes.isLoading} onMudou={recarregar} />
        </>
      )}

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

  if (carregando) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  if (titulos.length === 0) {
    return <div className={card} style={cardStyle}><span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Nenhum título neste momento do fluxo. Crie uma despesa em "+ Nova despesa".</span></div>;
  }

  return (
    <div className="flex flex-col gap-[8px]">
      {titulos.map((t) => (
        <div key={t.id} className={card} style={cardStyle}>
          <div className="flex flex-wrap items-start justify-between gap-[8px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="font-display text-[14px] font-bold">{t.descricao}</span>
                <Chip status={t.status} />
                {t.urgente && <span className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: '#fdecec', color: '#a12622' }}>Urgente</span>}
                {t.fornecedor.alertaProximoPagamento && (
                  <span className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: '#fff3d6', color: '#8a5a00' }} title="Primeiro pagamento após alteração bancária — confira os dados">
                    Alteração bancária recente
                  </span>
                )}
              </div>
              <div className="mt-[4px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                {t.fornecedor.nome} · {t.entidade.nome} · {t.natureza.nome} · {t.centro.nome} ·
                {' '}responsável econômico: {ROTULO_RESPONSAVEL_ECONOMICO[t.responsavelEconomico] ?? t.responsavelEconomico} ·
                {' '}vence {dataBR(t.vencimento)}{t.dataProgramada ? ` · programado ${dataBR(t.dataProgramada)}` : ''}
                {t.documentos.length > 0 && ` · ${t.documentos.length} documento(s)`}
              </div>
              {t.motivoDevolucao && <div className="mt-[4px] text-[12px]" style={{ color: '#8a5a00' }}>Devolvido: {t.motivoDevolucao}</div>}
              {t.motivoBloqueio && <div className="mt-[4px] text-[12px]" style={{ color: '#a12622' }}>Bloqueado: {t.motivoBloqueio}</div>}
              {t.pagamentos.map((p) => (
                <div key={p.id} className="mt-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Pago em {dataBR(p.dataEfetiva)} — {reais(p.valorEfetivo)}{p.identificador ? ` · id ${p.identificador}` : ''} · comprovante: {p.comprovanteNome ?? '—'}
                  {p.conciliacao ? ` · conciliação: ${rotuloStatus(p.conciliacao.status)} em ${dataBR(p.conciliacao.dataSaida)}` : ' · aguardando conciliação'}
                </div>
              ))}
            </div>
            <div className="text-right">
              <div className="font-display text-[18px] font-extrabold" style={{ color: 'var(--navy)' }}>{reais(t.valor)}</div>
              <div className="mt-[6px] flex flex-wrap justify-end gap-[6px]">
                {['SOLICITADO', 'EM_VALIDACAO'].includes(t.status) && (
                  <>
                    <button className={btnP} disabled={ocupado} onClick={() => rodar(() => financeiroService.validarTitulo(t.id, 'validar'), 'Validado — enviado à alçada na Central de Aprovações.')}>Validar</button>
                    <button className={btnS} disabled={ocupado} onClick={() => setAcao({ tipo: 'devolver', titulo: t })}>Devolver</button>
                    <button className={btnS} disabled={ocupado} onClick={() => setAcao({ tipo: 'bloquear', titulo: t })}>Bloquear</button>
                  </>
                )}
                {t.status === 'BLOQUEADO' && (
                  <button className={btnP} disabled={ocupado} onClick={() => rodar(() => financeiroService.validarTitulo(t.id, 'validar'), 'Liberado da análise — enviado à alçada.')}>Liberar e validar</button>
                )}
                {t.status === 'DEVOLVIDO' && (
                  <button className={btnP} disabled={ocupado} onClick={() => rodar(() => financeiroService.reenviarTitulo(t.id, {}), 'Reenviado para validação.')}>Reenviar</button>
                )}
                {['ENVIADO_BPO', 'AGUARDANDO_CORA', 'PROGRAMADO'].includes(t.status) && (
                  <button className={btnP} disabled={ocupado} onClick={() => setAcao({ tipo: 'pagar', titulo: t })}>Registrar pagamento</button>
                )}
                {t.status === 'PAGO' && t.pagamentos.some((p) => !p.conciliacao) && (
                  <button className={btnP} disabled={ocupado} onClick={() => setAcao({ tipo: 'conciliar', titulo: t })}>Conciliar</button>
                )}
                {['RASCUNHO', 'SOLICITADO', 'EM_VALIDACAO', 'DEVOLVIDO', 'BLOQUEADO'].includes(t.status) && (
                  <button className={btnS} disabled={ocupado} onClick={() => setAcao({ tipo: 'cancelar', titulo: t })}>Cancelar</button>
                )}
                {['APROVADO', 'PROGRAMADO', 'ENVIADO_BPO', 'AGUARDANDO_CORA', 'PAGO'].includes(t.status) && (
                  <button className={btnS} disabled={ocupado} onClick={() => setAcao({ tipo: 'reabrir', titulo: t })}>Solicitar reabertura</button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

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
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Voltar</button>
          <button className={btnP} disabled={ocupado || motivo.trim().length < 3} onClick={() => confirmar(motivo.trim())}>Confirmar</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalPagamento({ titulo, ocupado, fechar, confirmar }: { titulo: TituloPagarApi; ocupado: boolean; fechar: () => void; confirmar: (dto: { dataEfetiva: string; valorEfetivo: number; identificador?: string; comprovanteNome: string; divergencia?: string }) => void }) {
  const [data, setData] = useState(hojeLocalISO());
  const [valor, setValor] = useState(mascararDinheiro(String(titulo.valor)));
  const [identificador, setIdentificador] = useState('');
  const [comprovante, setComprovante] = useState('');
  return (
    <Modal open onClose={fechar} title="Registrar pagamento executado">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Marca o título como <b>Pago</b> — exige o comprovante. A conciliação com o extrato é um passo separado.
        </div>
        <label className="text-[12px] font-semibold">Data efetiva
          <input type="date" className={inputCls} style={inputStyle} value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className="text-[12px] font-semibold">Valor efetivo (R$) — informe juros/multa/desconto se houver
          <input className={inputCls} style={inputStyle} inputMode="numeric" value={valor} onChange={(e) => setValor(mascararDinheiro(e.target.value))} /></label>
        <label className="text-[12px] font-semibold">Identificador bancário (opcional)
          <input className={inputCls} style={inputStyle} value={identificador} onChange={(e) => setIdentificador(e.target.value)} /></label>
        <label className="text-[12px] font-semibold">Comprovante (nome do arquivo/registro) — obrigatório
          <input className={inputCls} style={inputStyle} value={comprovante} onChange={(e) => setComprovante(e.target.value)} placeholder="ex.: comprovante-pix-2026-08-03.pdf" /></label>
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Voltar</button>
          <button className={btnP} disabled={ocupado || !comprovante.trim() || dinheiroParaCentavos(valor) <= 0}
            onClick={() => confirmar({ dataEfetiva: data, valorEfetivo: dinheiroParaCentavos(valor), identificador: identificador || undefined, comprovanteNome: comprovante.trim() })}>
            Registrar como Pago
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ModalConciliacao({ titulo, ocupado, fechar, confirmar }: { titulo: TituloPagarApi; ocupado: boolean; fechar: () => void; confirmar: (pagamentoId: string, dto: { dataSaida: string; valorExtrato: number; observacao?: string }) => void }) {
  const pagamento = titulo.pagamentos.find((p) => !p.conciliacao);
  const [data, setData] = useState(hojeLocalISO());
  const [valor, setValor] = useState(pagamento ? mascararDinheiro(String(pagamento.valorEfetivo)) : '');
  const [obs, setObs] = useState('');
  if (!pagamento) return null;
  return (
    <Modal open onClose={fechar} title="Conciliar com o extrato">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Confirme a saída no extrato do banco. Se o valor do extrato divergir do pago ({reais(pagamento.valorEfetivo)}), a conciliação fica <b>Divergente</b> para tratamento.
        </div>
        <label className="text-[12px] font-semibold">Data da saída no extrato
          <input type="date" className={inputCls} style={inputStyle} value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className="text-[12px] font-semibold">Valor no extrato (R$)
          <input className={inputCls} style={inputStyle} inputMode="numeric" value={valor} onChange={(e) => setValor(mascararDinheiro(e.target.value))} /></label>
        <label className="text-[12px] font-semibold">Observação (opcional)
          <input className={inputCls} style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Voltar</button>
          <button className={btnP} disabled={ocupado || dinheiroParaCentavos(valor) <= 0}
            onClick={() => confirmar(pagamento.id, { dataSaida: data, valorExtrato: dinheiroParaCentavos(valor), observacao: obs || undefined })}>
            Confirmar conciliação
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Nova despesa (dimensões condicionais por natureza)
// ---------------------------------------------------------------------------

function ModalNovaDespesa({ config, fechar, onCriou }: { config: ConfiguracaoFinanceiro; fechar: () => void; onCriou: () => Promise<void> }) {
  const fornecedores = useQuery({ queryKey: ['fin-fornecedores'], queryFn: () => financeiroService.fornecedores() });
  const [f, setF] = useState({
    entidadeId: config.entidades[0]?.id ?? '', fornecedorId: '', descricao: '', valor: '', vencimento: '',
    competencia: '', naturezaId: config.naturezas[0]?.id ?? '', centroCustoAreaId: config.centros[0]?.id ?? '',
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
        centroCustoAreaId: f.centroCustoAreaId,
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
        <label className="text-[12px] font-semibold">Entidade legal (CNPJ que assume a obrigação)
          <select className={inputCls} style={inputStyle} value={f.entidadeId} onChange={set('entidadeId')}>
            {config.entidades.map((e) => <option key={e.id} value={e.id}>{e.razaoSocial}{e.unidadeNegocio ? ` — ${e.unidadeNegocio}` : ''}</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">Fornecedor (precisa estar ativo para pagar)
          <select className={inputCls} style={inputStyle} value={f.fornecedorId} onChange={set('fornecedorId')}>
            <option value="">Selecione…</option>
            {(fornecedores.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.nome} ({rotuloStatus(x.status)})</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">Descrição (objeto, ativo e fornecedor quando aplicável)
          <input className={inputCls} style={inputStyle} value={f.descricao} onChange={set('descricao')} placeholder="ex.: Troca de pneus — HB20S ABC1D23 — Auto Center X" /></label>
        <div className="grid grid-cols-2 gap-[8px]">
          <label className="text-[12px] font-semibold">Valor (R$)
            <input className={inputCls} style={inputStyle} inputMode="numeric" value={f.valor} onChange={(e) => setF({ ...f, valor: mascararDinheiro(e.target.value) })} /></label>
          <label className="text-[12px] font-semibold">Vencimento
            <input type="date" className={inputCls} style={inputStyle} value={f.vencimento} onChange={set('vencimento')} /></label>
          <label className="text-[12px] font-semibold">Competência (opcional)
            <input className={inputCls} style={inputStyle} value={f.competencia} onChange={set('competencia')} placeholder="ex.: 08/2026" /></label>
          <label className="text-[12px] font-semibold">Forma de pagamento
            <select className={inputCls} style={inputStyle} value={f.formaPagamento} onChange={set('formaPagamento')}>
              <option value="pix">PIX</option><option value="boleto">Boleto</option><option value="ted">TED</option><option value="cartao">Cartão (forma, não natureza)</option>
            </select></label>
        </div>
        <label className="text-[12px] font-semibold">Natureza financeira (o que está sendo pago)
          <select className={inputCls} style={inputStyle} value={f.naturezaId} onChange={set('naturezaId')}>
            {config.naturezas.map((n) => <option key={n.id} value={n.id}>{n.nome}{n.especial ? ' — aprovação da Diretoria' : ''}</option>)}
          </select></label>
        {natureza?.exigeAtivo && (
          <label className="text-[12px] font-semibold" style={{ color: '#8a5a00' }}>Veículo/ativo (obrigatório nesta natureza) — informe o código do ativo
            <input className={inputCls} style={inputStyle} value={f.ativoId} onChange={set('ativoId')} placeholder="código do ativo (da tela Estoque de ativos)" /></label>
        )}
        {natureza?.exigeJustificativa && (
          <label className="text-[12px] font-semibold" style={{ color: '#8a5a00' }}>Justificativa (natureza excepcional)
            <input className={inputCls} style={inputStyle} value={f.justificativaNatureza} onChange={set('justificativaNatureza')} /></label>
        )}
        <label className="text-[12px] font-semibold">Centro de custo (área responsável)
          <select className={inputCls} style={inputStyle} value={f.centroCustoAreaId} onChange={set('centroCustoAreaId')}>
            {config.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">Responsável econômico (quem arca com o valor)
          <select className={inputCls} style={inputStyle} value={f.responsavelEconomico} onChange={set('responsavelEconomico')}>
            <option value="AZIT">Azitmove</option><option value="INVESTIDOR">Investidor</option><option value="CLIENTE">Cliente</option><option value="OUTRA_ENTIDADE">Outra entidade</option>
          </select></label>
        <label className="text-[12px] font-semibold">Documento (nome do arquivo — nota fiscal, boleto, guia…)
          <input className={inputCls} style={inputStyle} value={f.documentoNome} onChange={set('documentoNome')} placeholder="ex.: nf-1234-autocentro.pdf" /></label>
        <label className="flex items-center gap-[6px] text-[12.5px]">
          <input type="checkbox" checked={f.urgente} onChange={(e) => setF({ ...f, urgente: e.target.checked })} />
          Urgente (dispensa o corte das 12h — exige justificativa e aprovação da Diretoria)
        </label>
        {f.urgente && (
          <input className={inputCls} style={inputStyle} value={f.justificativaUrgencia} onChange={set('justificativaUrgencia')} placeholder="Justificativa objetiva da urgência" />
        )}
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || !f.fornecedorId || !f.descricao.trim() || dinheiroParaCentavos(f.valor) <= 0 || !f.vencimento}
            onClick={criar}>{ocupado ? 'Criando…' : 'Criar despesa'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Orçamentos
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
            <div>
              <span className="font-display text-[14px] font-bold">{o.descricao}</span>
              <span className="ml-[8px]"><Chip status={o.status} /></span>
            </div>
            {o.status === 'APROVADO' && (
              <button className={btnP} disabled={ocupado} onClick={() => setConvertendo(o)}>Converter em despesa</button>
            )}
          </div>
          <div className="mt-[8px] grid gap-[6px] sm:grid-cols-2">
            {o.propostas.map((p) => (
              <div key={p.id} className="rounded-[10px] p-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: p.selecionado ? '2px solid var(--navy)' : '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <b>{p.fornecedor ?? 'Fornecedor'}</b>
                  <span className="font-bold">{reais(p.valor)}</span>
                </div>
                <div style={{ color: 'var(--text-muted)' }}>{[p.prazo && `prazo ${p.prazo}`, p.garantia && `garantia ${p.garantia}`, p.condicao].filter(Boolean).join(' · ') || '—'}</div>
                {o.status === 'EM_COTACAO' && (
                  <button className={`${btnS} mt-[6px]`} disabled={ocupado}
                    onClick={() => rodar(() => financeiroService.submeterOrcamento(o.id, p.id), 'Proposta selecionada — decisão na Central de Aprovações.')}>
                    Selecionar e submeter à alçada
                  </button>
                )}
                {p.selecionado && <div className="mt-[4px] text-[11px] font-bold" style={{ color: 'var(--navy)' }}>Proposta escolhida{p.motivoSelecao ? ` — ${p.motivoSelecao}` : ''}</div>}
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

function ModalConverterOrcamento({ orcamento, config, ocupado, fechar, confirmar }: { orcamento: OrcamentoApi; config: ConfiguracaoFinanceiro; ocupado: boolean; fechar: () => void; confirmar: (dto: { fornecedorId: string; vencimento: string; naturezaId: string; centroCustoAreaId: string }) => void }) {
  const fornecedores = useQuery({ queryKey: ['fin-fornecedores'], queryFn: () => financeiroService.fornecedores() });
  const selecionada = orcamento.propostas.find((p) => p.selecionado);
  const [f, setF] = useState({ fornecedorId: selecionada?.fornecedorId ?? '', vencimento: '', naturezaId: config.naturezas[0]?.id ?? '', centroCustoAreaId: config.centros[0]?.id ?? '' });
  return (
    <Modal open onClose={fechar} title="Converter orçamento em despesa">
      <div className="flex flex-col gap-[8px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          A despesa nasce com o valor da proposta escolhida ({selecionada ? reais(selecionada.valor) : '—'}) e mantém o vínculo com a decisão do orçamento.
        </div>
        <label className="text-[12px] font-semibold">Fornecedor (cadastrado e ativo)
          <select className={inputCls} style={inputStyle} value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })}>
            <option value="">Selecione…</option>
            {(fornecedores.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.nome} ({rotuloStatus(x.status)})</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">Vencimento
          <input type="date" className={inputCls} style={inputStyle} value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></label>
        <label className="text-[12px] font-semibold">Natureza financeira
          <select className={inputCls} style={inputStyle} value={f.naturezaId} onChange={(e) => setF({ ...f, naturezaId: e.target.value })}>
            {config.naturezas.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">Centro de custo
          <select className={inputCls} style={inputStyle} value={f.centroCustoAreaId} onChange={(e) => setF({ ...f, centroCustoAreaId: e.target.value })}>
            {config.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select></label>
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Voltar</button>
          <button className={btnP} disabled={ocupado || !f.fornecedorId || !f.vencimento} onClick={() => confirmar(f)}>Converter</button>
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
        <label className="text-[12px] font-semibold">Entidade legal
          <select className={inputCls} style={inputStyle} value={f.entidadeId} onChange={(e) => setF({ ...f, entidadeId: e.target.value })}>
            {config.entidades.map((e2) => <option key={e2.id} value={e2.id}>{e2.razaoSocial}</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">O que precisa ser comprado/contratado
          <input className={inputCls} style={inputStyle} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
        <div className="text-[12px] font-bold">Propostas</div>
        {propostas.map((p, i) => (
          <div key={i} className="grid grid-cols-2 gap-[6px] rounded-[10px] p-[8px]" style={{ background: 'var(--surface-input)' }}>
            <input className={inputCls} style={{ background: '#fff', border: '1px solid var(--border)' }} placeholder="Fornecedor" value={p.nomeFornecedor} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, nomeFornecedor: e.target.value } : x)))} />
            <input className={inputCls} style={{ background: '#fff', border: '1px solid var(--border)' }} placeholder="Valor (R$)" inputMode="numeric" value={p.valor} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, valor: mascararDinheiro(e.target.value) } : x)))} />
            <input className={inputCls} style={{ background: '#fff', border: '1px solid var(--border)' }} placeholder="Prazo" value={p.prazo} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, prazo: e.target.value } : x)))} />
            <input className={inputCls} style={{ background: '#fff', border: '1px solid var(--border)' }} placeholder="Condição de pagamento" value={p.condicao} onChange={(e) => setPropostas(propostas.map((x, j) => (j === i ? { ...x, condicao: e.target.value } : x)))} />
          </div>
        ))}
        <button className={btnS} onClick={() => setPropostas([...propostas, { nomeFornecedor: '', valor: '', prazo: '', condicao: '' }])}>+ Adicionar proposta</button>
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || !f.descricao.trim()} onClick={criar}>Criar solicitação</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Lotes
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
            <div>
              <span className="font-display text-[14px] font-bold">{l.entidade}</span>
              <span className="ml-[8px]"><Chip status={l.status} deLote /></span>
              {l.urgente && <span className="ml-[6px] rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: '#fdecec', color: '#a12622' }}>Urgente</span>}
              <div className="mt-[2px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                {l.conta} · programado {dataBR(l.dataProgramada)} · versão {l.versao} · {l.totalItens} título(s) · {reais(l.totalValor)}
                {l.enviadoEm && ` · enviado ${dataBR(l.enviadoEm)}`}
              </div>
            </div>
            <div className="flex flex-wrap gap-[6px]">
              <button className={btnS} disabled={ocupado} onClick={() => financeiroService.baixarResumoLote(l.id)}>Baixar resumo (BPO)</button>
              {l.status === 'APROVADO' && <button className={btnP} disabled={ocupado} onClick={() => rodar(() => financeiroService.eventoLote(l.id, 'enviado_bpo'), 'Envio ao BPO registrado.')}>Marcar enviado ao BPO</button>}
              {l.status === 'ENVIADO_BPO' && <button className={btnP} disabled={ocupado} onClick={() => rodar(() => financeiroService.eventoLote(l.id, 'cadastrado_cora'), 'Cadastro no banco registrado — aguardando aprovação do Diretor no aplicativo.')}>Marcar cadastrado no banco</button>}
              {l.status === 'AGUARDANDO_APROVACAO_BANCO' && <button className={btnP} disabled={ocupado} onClick={() => rodar(() => financeiroService.eventoLote(l.id, 'aprovado_banco'), 'Aprovação bancária registrada — registre os pagamentos nos títulos.')}>Marcar aprovado no banco</button>}
              {l.status === 'EM_PREPARACAO' && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Aguardando liberação na Central de Aprovações</span>}
            </div>
          </div>
          <div className="mt-[8px] flex flex-col gap-[4px]">
            {l.titulos.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-[8px] px-[10px] py-[6px] text-[12.5px]" style={{ background: 'var(--surface-input)' }}>
                <span>{t.fornecedor} — {t.descricao}{t.alertaBancario && <b style={{ color: '#8a5a00' }}> · conferir dados bancários (alteração recente)</b>}</span>
                <span className="flex items-center gap-[8px]"><Chip status={t.status} /><b>{reais(t.valor)}</b></span>
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
        <label className="text-[12px] font-semibold">Entidade legal
          <select className={inputCls} style={inputStyle} value={entidadeId} onChange={(e) => { setEntidadeId(e.target.value); setContaId(''); setSelecionados([]); }}>
            {config.entidades.map((e2) => <option key={e2.id} value={e2.id}>{e2.razaoSocial}</option>)}
          </select></label>
        <label className="text-[12px] font-semibold">Conta pagadora (da própria entidade)
          <select className={inputCls} style={inputStyle} value={contaId} onChange={(e) => setContaId(e.target.value)}>
            <option value="">Selecione…</option>
            {(entidade?.contas ?? []).map((c) => <option key={c.id} value={c.id}>{c.banco}{c.agencia ? ` ag ${c.agencia}` : ''}{c.conta ? ` c/c ${c.conta}` : ''}</option>)}
          </select></label>
        <div className="text-[12px] font-bold">Títulos aprovados desta entidade</div>
        {daEntidade.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum título aprovado para esta entidade.</div>}
        {daEntidade.map((t) => (
          <label key={t.id} className="flex items-center justify-between gap-[8px] rounded-[8px] px-[10px] py-[7px] text-[12.5px]" style={{ background: 'var(--surface-input)' }}>
            <span className="flex items-center gap-[8px]">
              <input type="checkbox" checked={selecionados.includes(t.id)} onChange={(e) => setSelecionados(e.target.checked ? [...selecionados, t.id] : selecionados.filter((x) => x !== t.id))} />
              {t.fornecedor.nome} — {t.descricao} (vence {dataBR(t.vencimento)})
            </span>
            <b>{reais(t.valor)}</b>
          </label>
        ))}
        <div className="flex items-center justify-between rounded-[10px] px-[10px] py-[8px] text-[13px]" style={{ background: 'var(--surface-input)' }}>
          <span>Total do lote ({selecionados.length} título(s))</span>
          <b>{reais(total)}</b>
        </div>
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || !contaId || selecionados.length === 0} onClick={criar}>Formar lote e pedir liberação</button>
        </div>
      </div>
    </Modal>
  );
}
