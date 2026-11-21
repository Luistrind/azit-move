import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, type AcertoRescisao } from '@azit/utils';
import { operacoesService, type Rescisao } from '../services/operacoes.service';
import { BOLETO_SALDO_COLORS } from '../config/statusColors';
import { Modal } from '../components/Modal';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Metrica } from '../components/Metrica';
import { Tabela } from '../components/Tabela';
import { StatusBadge } from '../components/StatusBadge';
import { toast } from '../components/Toast';
import { mensagemErro, ROLE_BOLETO_SALDO_RESCISAO, usePodeRole } from '../lib/permissoes';
import { dataBR, hojeBrasilISO, instanteCurtoBR } from '../lib/datas';
import { BotaoArea } from './BotaoArea';
import { CustosRecuperacao, rotuloTipoCusto } from './CustosRecuperacao';
import { AreaSistema } from '@azit/types';

// Rescisão do contrato (doc 02 §29; fluxo direto, custos e boleto do saldo §29.3,
// decisões Luís 20–21/11/2026). Componentes genéricos configurados por props; a
// CONTA do acerto é do backend (@azit/utils): aqui só se exibe a memória — base
// dos 20% = principal pago (entrada + parcelas); o crédito abate a dívida TODA
// (parcelas vencidas até a data em que o carro voltou + encargo + custos da
// recuperação + multas do veículo); o resto é a devolver ou saldo remanescente.

const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

type LinhaDivida = { id: string; item: string; detalhe: string; valor: number; estimativa?: boolean };

function linhasDaDivida(a: AcertoRescisao): LinhaDivida[] {
  return [
    ...a.vencidas.map((v) => ({
      id: `p-${v.id}`,
      item: `Parcela ${v.display}`,
      detalhe: `venceu em ${dataBR(v.dataVencimento)} · ${v.diasAtraso} dia(s) · ${formatCurrency(v.valorNominal)} + encargo ${formatCurrency(v.encargo)}`,
      valor: v.total,
    })),
    ...(a.custos ?? []).map((c) => ({ id: `c-${c.id}`, item: rotuloTipoCusto(c.tipo), detalhe: c.descricao, valor: c.valor, estimativa: c.orcado })),
    ...(a.multas ?? []).map((m) => ({ id: `m-${m.id}`, item: 'Multa do veículo', detalhe: m.descricao, valor: m.valor })),
  ];
}

function MemoriaAcerto({ a }: { a: AcertoRescisao }) {
  const resultado = a.valorADevolver > 0
    ? { label: 'A devolver ao cliente', valor: formatCurrency(a.valorADevolver), cor: 'var(--ok-fg)' }
    : a.saldoRemanescente > 0
      ? { label: 'Saldo remanescente (cliente fica devendo)', valor: formatCurrency(a.saldoRemanescente), cor: 'var(--danger-fg)' }
      : { label: 'Resultado', valor: 'Crédito e dívida se anulam', cor: undefined };
  const custos = a.custosCliente ?? 0;
  const orcado = a.custosOrcados ?? 0;
  const multas = a.multasVeiculo ?? 0;
  const linhas = linhasDaDivida(a);
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-3">
        <Metrica tom="claro" label="Principal pago" valor={formatCurrency(a.principalPago)} detalhe={`entrada ${formatCurrency(a.entradaPaga)} + ${a.parcelasPagas} parcela(s) ${formatCurrency(a.principalParcelas)}`} />
        <Metrica tom="claro" label={`Crédito do cliente (${a.percentualCredito}%)`} valor={formatCurrency(a.valorCredito)} detalhe="só sobre o principal: sem proteção, taxas ou encargos" />
        <Metrica tom="claro" label={resultado.label} valor={<span style={{ color: resultado.cor }}>{resultado.valor}</span>} detalhe={`dívida ${formatCurrency(a.dividaTotal)} − crédito ${formatCurrency(a.valorCredito)}`} />
        <Metrica tom="claro" label="Parcelas vencidas até o carro voltar" valor={formatCurrency(a.dividaVencida + a.encargosVencidos)} detalhe={`${a.vencidas.length} parcela(s) ${formatCurrency(a.dividaVencida)} + encargos ${formatCurrency(a.encargosVencidos)}`} />
        <Metrica tom="claro" label="Custos da recuperação e multas" valor={formatCurrency(custos + multas)} detalhe={`${(a.custos ?? []).length} custo(s) ${formatCurrency(custos)}${orcado > 0 ? ` (${formatCurrency(orcado)} ainda orçado)` : ''}${multas > 0 ? ` + multas ${formatCurrency(multas)}` : ''}`} />
        <Metrica tom="claro" label="Parcelas depois da data, não cobradas" valor={String(a.futuras.quantidade)} detalhe={formatCurrency(a.futuras.valorNominal)} />
      </div>
      {linhas.length > 0 && (
        <Tabela<LinhaDivida>
          colunas={[
            { chave: 'item', titulo: 'O que compõe a dívida', celular: 'titulo', render: (l) => <b className="font-semibold" style={{ color: 'var(--text-primary)' }}>{l.item}</b> },
            { chave: 'detalhe', titulo: 'Detalhe', celular: 'subtitulo', render: (l) => <span>{l.detalhe}{l.estimativa ? <span className="ml-[6px] rounded-[6px] px-[6px] py-[1px] text-[10.5px] font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>estimativa</span> : null}</span> },
            { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-semibold', render: (l) => formatCurrency(l.valor) },
          ]}
          linhas={linhas}
          chave={(l) => l.id}
          larguraMinima={520}
        />
      )}
    </div>
  );
}

// Janela de rescindir: 1) data em que o carro voltou, como voltou, custos e a
// prévia do acerto; 2) confirmação que diz o que vai acontecer. Efetiva na hora.
export function ModalRescisao({ contratoId, onClose, onRescindido }: { contratoId: string; onClose: () => void; onRescindido: () => Promise<void> | void }) {
  const [dataBase, setDataBase] = useState(hojeBrasilISO());
  const [origem, setOrigem] = useState<'RETOMADA' | 'DEVOLUCAO'>('RETOMADA');
  const [observacao, setObservacao] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [ciente, setCiente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const previa = useQuery({
    queryKey: ['rescisao-previa', contratoId, dataBase],
    queryFn: () => operacoesService.previaRescisao(contratoId, dataBase),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(dataBase),
  });
  useEffect(() => {
    if (previa.isError) toast.erro(mensagemErro(previa.error));
  }, [previa.isError, previa.error]);

  async function rescindir() {
    setEnviando(true);
    try {
      const r = await operacoesService.rescindir(contratoId, { dataBase, origem, observacao: observacao.trim() || undefined });
      toast.sucesso('Contrato rescindido. O acerto está na ficha do contrato.');
      for (const aviso of r.avisos ?? []) toast.erro(aviso);
      await onRescindido();
      onClose();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const p = previa.data;
  const a = p?.acerto;

  if (confirmando && p && a) {
    const cq = p.consequencias;
    return (
      <Modal open onClose={onClose} title="Confirmar a rescisão" largura={560}>
        <div className="flex flex-col gap-[12px] text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
          <p>
            Você vai rescindir o contrato <b style={{ color: 'var(--text-primary)' }}>{p.contrato.numero}</b> de <b style={{ color: 'var(--text-primary)' }}>{p.contrato.titular}</b>
            {p.contrato.ativo ? <> ({p.contrato.ativo.descricao}{p.contrato.ativo.placa ? ` · ${p.contrato.ativo.placa}` : ''})</> : null}. <b style={{ color: 'var(--danger-fg)' }}>Vale na hora e não tem como desfazer pela tela.</b>
          </p>
          <ul className="flex list-disc flex-col gap-[6px] pl-[18px]">
            <li>O contrato é <b>encerrado</b> com data de <b>{dataBR(dataBase)}</b> ({origem === 'RETOMADA' ? 'carro retomado pela Azit' : 'carro devolvido pelo cliente'}) e o veículo volta para a frota como <b>Recuperado</b>.</li>
            <li><b>{cq.cobrancasNoAr}</b> cobrança(s) deste contrato <b>saem do ar no Asaas</b> — as vencidas e as futuras. O cliente passa a dever um número só: o saldo do acerto.</li>
            <li><b>{a.futuras.quantidade}</b> parcela(s) com vencimento depois de {dataBR(dataBase)} ({formatCurrency(a.futuras.valorNominal)}) <b>deixam de ser cobradas</b>.</li>
            <li>
              Acerto: dívida de <b>{formatCurrency(a.dividaTotal)}</b> menos o crédito de <b>{formatCurrency(a.valorCredito)}</b> ({a.percentualCredito}% do que ele pagou) →{' '}
              {a.saldoRemanescente > 0
                ? <><b style={{ color: 'var(--danger-fg)' }}>saldo de {formatCurrency(a.saldoRemanescente)}</b> a cobrar do cliente (o boleto único você gera depois, na ficha).</>
                : a.valorADevolver > 0
                  ? <><b style={{ color: 'var(--ok-fg)' }}>{formatCurrency(a.valorADevolver)} a devolver</b> ao cliente.</>
                  : <b>crédito e dívida se anulam.</b>}
            </li>
            {(a.multas ?? []).length > 0 && <li><b>{(a.multas ?? []).length}</b> multa(s) do veículo entram na dívida e não poderão mais ir para fatura.</li>}
            {cq.multasFora > 0 && <li><b>{cq.multasFora}</b> ocorrência(s) em recurso ou aguardando comprovante <b>ficam de fora</b> do acerto.</li>}
            {cq.outrosContratosAtivos > 0 && <li>A conta tem <b>{cq.outrosContratosAtivos}</b> outro(s) contrato(s) ativo(s): fatura que mistura os dois é recalculada e reemitida só com o que sobra.</li>}
            <li>Custos podem continuar sendo lançados depois; o saldo se ajusta sozinho.</li>
          </ul>
          <label className="flex items-start gap-[8px] rounded-[10px] px-[12px] py-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} className="mt-[2px]" />
            <span>Conferi a data em que o carro voltou e os custos, e entendo que as cobranças saem do ar agora.</span>
          </label>
          <div className="flex flex-col-reverse gap-[8px] sm:flex-row sm:justify-end">
            <Botao variante="secundaria" onClick={() => { setConfirmando(false); setCiente(false); }} disabled={enviando}>Voltar e revisar</Botao>
            <Botao variante="perigo" onClick={() => void rescindir()} carregando={enviando} disabled={!ciente}>Rescindir contrato agora</Botao>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Rescindir contrato" largura={860}>
      <div className="flex flex-col gap-[12px] text-[12.5px]">
        <p style={{ color: 'var(--text-secondary)' }}>
          Para quando o carro <b>voltou</b> — retomado ou devolvido pelo cliente. O cliente tem direito a <b>20% do principal pago</b> (entrada + parcelas); esse crédito abate as parcelas vencidas <b>até o dia em que o carro voltou</b>, os custos da recuperação e as multas. Parcela que venceu depois dessa data não é cobrada, mesmo que você esteja lançando a rescisão dias depois.
        </p>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-[200px_1fr]">
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Dia em que o carro voltou</span>
            <input type="date" value={dataBase} max={hojeBrasilISO()} onChange={(e) => setDataBase(e.target.value)} className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
          </label>
          <div className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Como voltou</span>
            <span className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label="Como o carro voltou">
              {([['RETOMADA', 'Retomado pela Azit'], ['DEVOLUCAO', 'Devolvido pelo cliente']] as const).map(([v, rotulo]) => (
                <button key={v} type="button" role="radio" aria-checked={origem === v} onClick={() => setOrigem(v)} className="h-[34px] rounded-[10px] px-[12px] text-[12.5px] font-semibold" style={origem === v ? { background: 'var(--accent)', color: 'var(--navy)', border: '1px solid transparent' } : inputStyle}>
                  {rotulo}
                </button>
              ))}
            </span>
          </div>
        </div>
        <label className="flex flex-col gap-[4px] text-[12px]">
          <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Observação <span className="font-normal" style={{ color: 'var(--text-muted)' }}>· opcional, fica no histórico</span></span>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="ex: veículo retomado em Cariacica, cliente sem contato desde outubro" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
        </label>

        <div className="flex flex-col gap-[8px] rounded-[12px] p-[12px]" style={{ border: '1px solid var(--border)' }}>
          <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Custos da recuperação</div>
          <CustosRecuperacao contratoId={contratoId} compacto />
        </div>

        {previa.isLoading && <div style={{ color: 'var(--text-muted)' }}>Calculando o acerto…</div>}
        {p && a && (
          <>
            {!p.elegivel && (
              <div className="rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>{p.motivoInelegivel}</div>
            )}
            <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              {p.contrato.numero}{p.contrato.ativo ? ` · ${p.contrato.ativo.descricao}${p.contrato.ativo.placa ? ` · ${p.contrato.ativo.placa}` : ''}` : ''} · {p.contrato.diasAtraso} dia(s) de atraso hoje · {formatCurrency(p.contrato.saldoEmAberto)} em aberto no cronograma
            </div>
            <MemoriaAcerto a={a} />
          </>
        )}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="secundaria" tamanho="sm" onClick={onClose}>Voltar</Botao>
          <Botao variante="perigo" tamanho="sm" onClick={() => setConfirmando(true)} disabled={!p?.elegivel}>Continuar para a confirmação</Botao>
        </div>
      </div>
    </Modal>
  );
}

// Boleto único do saldo remanescente (doc 02 §29.3): gerar, acompanhar, e o que
// fazer se vencer. O que não pode, não aparece (regra 13/11).
function BoletoSaldo({ r, contratoId }: { r: Rescisao; contratoId: string }) {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const [ocupado, setOcupado] = useState(false);
  const saldo = r.acerto.saldoRemanescente;
  const b = r.cobrancaSaldo;
  if (saldo <= 0 && !b && !r.saldoPagoEm) return null;

  async function gerar() {
    setOcupado(true);
    try {
      const x = await operacoesService.gerarBoletoSaldoRescisao(r.id);
      toast.sucesso(`Boleto do saldo no ar: ${formatCurrency(x.valor)}, vence em ${dataBR(x.vencimento)}.`);
      await queryClient.invalidateQueries({ queryKey: ['contrato', contratoId, 'rescisoes'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.sucesso('Link do boleto copiado.');
    } catch {
      toast.erro('Não consegui copiar — abra o boleto e copie o endereço.');
    }
  }

  const podeGerar = pode(ROLE_BOLETO_SALDO_RESCISAO) && !r.saldoPagoEm && saldo > 0 && (!b || b.desatualizada);
  const estado = r.saldoPagoEm ? 'Pago' : !b ? null : b.desatualizada ? 'Valor desatualizado' : b.vencida ? 'Vencido' : 'No ar';
  const orcado = r.acerto.custosOrcados ?? 0;

  return (
    <div className="flex flex-col gap-[8px] rounded-[12px] px-[14px] py-[12px] text-[12.5px]" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-center gap-[8px]">
        <b className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Boleto único do saldo</b>
        {estado && <StatusBadge label={estado} colors={BOLETO_SALDO_COLORS} />}
        <span className="grow" />
        {b?.link && !r.saldoPagoEm && !b.desatualizada && (
          <>
            <Botao variante="secundaria" tamanho="sm" onClick={() => void copiar(b.link!)}>Copiar link</Botao>
            <a href={b.link} target="_blank" rel="noreferrer" className="inline-flex h-[30px] items-center rounded-[9px] px-[10px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>Abrir boleto</a>
          </>
        )}
        {podeGerar && <Botao variante="primaria" tamanho="sm" onClick={() => void gerar()} carregando={ocupado}>{b ? 'Gerar boleto com o valor novo' : 'Gerar boleto do saldo'}</Botao>}
      </div>
      <div style={{ color: 'var(--text-body)' }}>
        {r.saldoPagoEm ? (
          <>Saldo pago em <b>{dataBR(r.saldoPagoEm)}</b>{r.saldoValorPago != null ? <> — <b>{formatCurrency(r.saldoValorPago)}</b></> : null}. O acerto está liquidado.</>
        ) : !b ? (
          <>O cliente deve <b>{formatCurrency(saldo)}</b>. Quando os custos estiverem fechados, gere o boleto: vence em <b>15 dias úteis</b> e, se não for pago, é ele que se negativa no Asaas.{orcado > 0 ? <> Ainda há <b>{formatCurrency(orcado)}</b> em custos orçados — se o valor mudar depois, o boleto é trocado.</> : null}</>
        ) : b.desatualizada ? (
          <>O saldo mudou para <b>{formatCurrency(saldo)}</b>, mas o boleto no ar ainda é de <b>{formatCurrency(b.valor)}</b>: a troca automática falhou. Gere de novo.</>
        ) : b.vencida ? (
          <><b>{formatCurrency(b.valor)}</b> venceu em <b>{dataBR(b.vencimento)}</b> sem pagamento. Se for o caso, negative este boleto no painel do Asaas (Cobranças › o boleto › Negativar). O Asaas pede CPF, telefone e endereço completo do cliente.</>
        ) : (
          <><b>{formatCurrency(b.valor)}</b>, vence em <b>{dataBR(b.vencimento)}</b> (15 dias úteis). Envie o link ao cliente. Se o saldo mudar antes do pagamento, o boleto é trocado sozinho.</>
        )}
      </div>
    </div>
  );
}

// Bloco da ficha: pedido antigo pendente na Central (link ao dossiê) ou o
// acerto da rescisão, com boleto do saldo, devolução e histórico de ajustes.
export function BlocoRescisao({ contratoId, encerradoPorRescisao, podeOperar }: { contratoId: string; encerradoPorRescisao: boolean; podeOperar: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['contrato', contratoId, 'rescisoes'], queryFn: () => operacoesService.rescisoes(contratoId) });
  const [devolvendo, setDevolvendo] = useState<Rescisao | null>(null);
  const [dataDevolucao, setDataDevolucao] = useState(hojeBrasilISO());
  const [obsDevolucao, setObsDevolucao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const lista = q.data ?? [];
  const pendente = lista.find((r) => r.status === 'pendente');
  const efetivada = lista.find((r) => r.status === 'efetivada');

  async function registrarDevolucao() {
    if (!devolvendo) return;
    setEnviando(true);
    try {
      await operacoesService.registrarDevolucaoRescisao(devolvendo.id, { data: dataDevolucao, observacao: obsDevolucao.trim() || undefined });
      toast.sucesso('Devolução registrada.');
      setDevolvendo(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contrato', contratoId, 'rescisoes'] }),
        queryClient.invalidateQueries({ queryKey: ['contrato', contratoId, 'custos-recuperacao'] }),
      ]);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (pendente) {
    return (
      <div className="flex flex-wrap items-center gap-[10px] rounded-card px-[16px] py-[12px] text-[12.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--border)' }}>
        <span>Pedido de rescisão <b>antigo aguardando aprovação</b> na Central (data-base {dataBR(pendente.dataBase)}). Decida ou cancele lá para poder rescindir por aqui.</span>
        {pendente.aprovacaoId && (
          <BotaoArea area={AreaSistema.APROVACOES} variante="secundaria" tamanho="sm" onClick={() => navigate(`/aprovacoes/${pendente.aprovacaoId}`)}>Ver dossiê →</BotaoArea>
        )}
      </div>
    );
  }
  if (!encerradoPorRescisao || !efetivada) return null;
  const a = efetivada.acerto;
  const custos = (a.custosCliente ?? 0) + (a.multasVeiculo ?? 0);
  return (
    <Bloco
      titulo="Acerto da rescisão"
      tag={`carro ${efetivada.origem === 'devolucao' ? 'devolvido pelo cliente' : 'retomado'} em ${dataBR(efetivada.dataBase)}${efetivada.efetivadaPorNome ? ` · rescindido por ${efetivada.efetivadaPorNome}` : ''}`}
      leitura={
        <>
          Dívida de <b>{formatCurrency(a.dividaTotal)}</b> ({a.vencidas.length} parcela(s) vencida(s){custos > 0 ? <> + <b>{formatCurrency(custos)}</b> de custos e multas</> : null}) menos o crédito de <b>{formatCurrency(a.valorCredito)}</b> ({a.percentualCredito}% do principal pago)
          {a.valorADevolver > 0 ? <> · <b>{formatCurrency(a.valorADevolver)}</b> a devolver ao cliente{efetivada.devolvidoEm ? <> (devolvido em <b>{dataBR(efetivada.devolvidoEm)}</b>)</> : ' — pendente'}</> : null}
          {a.saldoRemanescente > 0 ? <> · o cliente fica devendo <b>{formatCurrency(a.saldoRemanescente)}</b>{efetivada.saldoPagoEm ? <> (pago em <b>{dataBR(efetivada.saldoPagoEm)}</b>)</> : null}</> : null}.
        </>
      }
      acao={
        podeOperar && a.valorADevolver > 0 && !efetivada.devolvidoEm ? (
          <Botao variante="primaria" tamanho="sm" onClick={() => setDevolvendo(efetivada)}>Registrar devolução feita</Botao>
        ) : undefined
      }
    >
      <MemoriaAcerto a={a} />
      <BoletoSaldo r={efetivada} contratoId={contratoId} />
      {efetivada.ajustes.length > 0 && (
        <div className="flex flex-col gap-[4px] text-[12px]">
          <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>Como o saldo mudou depois da rescisão</div>
          {efetivada.ajustes.map((j) => {
            const antes = j.saldoAntes > 0 ? `saldo ${formatCurrency(j.saldoAntes)}` : j.devolverAntes > 0 ? `a devolver ${formatCurrency(j.devolverAntes)}` : 'zerado';
            const depois = j.saldoDepois > 0 ? `saldo ${formatCurrency(j.saldoDepois)}` : j.devolverDepois > 0 ? `a devolver ${formatCurrency(j.devolverDepois)}` : 'zerado';
            return (
              <div key={j.em} className="flex flex-wrap items-baseline gap-x-[10px] gap-y-[2px] py-[4px]" style={{ borderTop: '1px solid var(--border-light)' }}>
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{instanteCurtoBR(j.em)}{j.por ? ` · ${j.por}` : ''}</span>
                <span className="grow" style={{ color: 'var(--text-body)' }}>{j.motivo}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{antes} → <b>{depois}</b></span>
              </div>
            );
          })}
        </div>
      )}
      {efetivada.observacao && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Observação: {efetivada.observacao}</div>}
      {efetivada.devolucaoObservacao && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Devolução: {efetivada.devolucaoObservacao}</div>}
      {efetivada.avisos.length > 0 && (
        <ul className="flex flex-col gap-[4px] text-[12px]" style={{ color: 'var(--warn-fg)' }}>
          {efetivada.avisos.map((v) => <li key={v}>⚠ {v}</li>)}
        </ul>
      )}
      {devolvendo && (
        <Modal open onClose={() => setDevolvendo(null)} title="Registrar devolução ao cliente">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p>Registra que os <b>{formatCurrency(devolvendo.acerto.valorADevolver)}</b> foram devolvidos ao cliente. O pagamento em si é feito fora do sistema. <b>Depois disso os custos do cliente não podem mais ser alterados</b> — confira se estão fechados.</p>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Data da devolução</span>
              <input type="date" value={dataDevolucao} max={hojeBrasilISO()} onChange={(e) => setDataDevolucao(e.target.value)} className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Observação (opcional)</span>
              <input value={obsDevolucao} onChange={(e) => setObsDevolucao(e.target.value)} placeholder="ex: PIX para a conta informada pelo cliente" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
            </label>
            <div className="flex flex-wrap justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setDevolvendo(null)}>Voltar</Botao>
              <Botao variante="primaria" tamanho="sm" onClick={() => void registrarDevolucao()} disabled={enviando}>Registrar devolução</Botao>
            </div>
          </div>
        </Modal>
      )}
    </Bloco>
  );
}
