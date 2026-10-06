import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import {
  migracaoLegadoService as svc,
  type CobrancaLegada,
  type LinhaConciliacao,
  type TermosContratoLegado,
  type TipoCobrancaLegada,
  type DesfechoDivergencia,
  type DivergenciaReconhecida,
  type ModoVencimentos, type ModoConciliacao,
  type PlanoMigracao,
} from '../services/migracao-legado.service';
import { Modal } from '../components/Modal';
import { Metrica } from '../components/Metrica';
import { StatusBadge } from '../components/StatusBadge';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';
import { CASO_LEGADO_STATUS_COLORS, COBRANCA_LEGADA_COLORS, CONCILIACAO_LINHA_COLORS, CONFIANCA_LINHA_COLORS, SITUACAO_LEGADO_COLORS } from '../config/statusColors';

// Caso do legado — F2 (doc 02 §26.7): o lado PopHub (termos + PDF), a leitura
// das cobranças e a conciliação. Regras propõem, o operador decide; validar
// só libera sem pendência.

const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const cpfBR = (v: string | null) => {
  if (!v) return '—';
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
};
const reaisTxt = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const centavosOuNull = (s: string) => (s.trim() === '' ? null : reaisParaCentavos(s));
const intOuNull = (s: string) => (s.trim() === '' ? null : parseInt(s.replace(/\D/g, ''), 10) || null);
const txtOuNull = (s: string) => (s.trim() === '' ? null : s.trim());
// Ano digitado com dois dígitos ("24") vira 2024.
const anoOuNull = (s: string) => { const n = intOuNull(s); return n != null && n < 100 ? 2000 + n : n; };

const ROLE_LEGADO = ['ADMIN', 'DIRETOR', 'OPERADOR', 'FINANCEIRO'];
// Migrar (F3) é a liberação para produção: só ADMIN/DIRETOR, caso a caso.
const ROLE_MIGRAR = ['ADMIN', 'DIRETOR'];
const btn = 'h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50';
const btnPri = { background: 'var(--accent)', color: '#fff' } as const;
const btnSec = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' } as const;
const inputCls = 'w-full rounded-[8px] px-[9px] py-[6px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const th = 'px-[8px] py-[7px] text-left text-[10.5px] font-bold uppercase tracking-[.04em]';
const td = 'px-[8px] py-[6px] text-[12px] align-top';
const bloco = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const tituloBloco = 'text-[11px] font-bold uppercase tracking-[.04em]';

const SITUACAO_LINHA_ROTULO: Record<string, string> = {
  paga: 'paga', paga_com_encargo: 'paga c/ encargo', paga_por_acordo: 'paga por acordo', em_acordo: 'em acordo', pendente: 'pendente', vencida: 'vencida', nao_cobrada: 'não cobrada', futura: 'futura', valor_diverge: 'valor diverge',
};
const CAMPO_ROTULO: Record<string, string> = {
  numeroOrigem: 'nº do contrato', dataAssinatura: 'data de assinatura', compradorCpf: 'CPF do comprador', 'veiculo.placa': 'placa', 'veiculo.chassi': 'chassi',
  valorTotal: 'valor total', entradaValor: 'entrada', 'parcelas.quantidade': 'nº de parcelas', 'parcelas.valor': 'valor da parcela', 'parcelas.primeiraEm': '1ª parcela',
};

// ---------- formulário dos termos (strings; converte ao salvar) ----------
type FormTermos = {
  numeroOrigem: string; dataAssinatura: string; compradorNome: string; compradorCpf: string; garantidorNome: string; garantidorCpf: string;
  marca: string; modelo: string; anoFabricacao: string; anoModelo: string; cor: string; placa: string; chassi: string; renavam: string; origem: string; combustivel: string; quilometragem: string;
  valorTotal: string; entradaValor: string;
  parcQuantidade: string; parcValor: string; parcPrimeiraEm: string; parcTotal: string;
  temIntermediarias: boolean; interQuantidade: string; interValor: string; interPrimeiraEm: string; interTotal: string;
  seguroSemanal: string; taxaSemanal: string; parcelaIncluiServicos: boolean; indiceReajuste: string; multaAtrasoPct: string; jurosMensalPct: string; garantiaDias: string; observacoes: string;
};
function formDosTermos(t: TermosContratoLegado | null): FormTermos {
  return {
    numeroOrigem: t?.numeroOrigem ?? '', dataAssinatura: t?.dataAssinatura ?? '', compradorNome: t?.compradorNome ?? '', compradorCpf: t?.compradorCpf ?? '',
    garantidorNome: t?.garantidorNome ?? '', garantidorCpf: t?.garantidorCpf ?? '',
    marca: t?.veiculo.marca ?? '', modelo: t?.veiculo.modelo ?? '', anoFabricacao: t?.veiculo.anoFabricacao?.toString() ?? '', anoModelo: t?.veiculo.anoModelo?.toString() ?? '',
    cor: t?.veiculo.cor ?? '', placa: t?.veiculo.placa ?? '', chassi: t?.veiculo.chassi ?? '', renavam: t?.veiculo.renavam ?? '', origem: t?.veiculo.origem ?? '', combustivel: t?.veiculo.combustivel ?? '',
    quilometragem: t?.veiculo.quilometragem?.toString() ?? '',
    valorTotal: reaisTxt(t?.valorTotal), entradaValor: reaisTxt(t?.entradaValor),
    parcQuantidade: t?.parcelas.quantidade?.toString() ?? '', parcValor: reaisTxt(t?.parcelas.valor), parcPrimeiraEm: t?.parcelas.primeiraEm ?? '', parcTotal: reaisTxt(t?.parcelas.total),
    temIntermediarias: !!t?.intermediarias, interQuantidade: t?.intermediarias?.quantidade?.toString() ?? '', interValor: reaisTxt(t?.intermediarias?.valor), interPrimeiraEm: t?.intermediarias?.primeiraEm ?? '', interTotal: reaisTxt(t?.intermediarias?.total),
    seguroSemanal: reaisTxt(t?.seguroSemanal ?? 5000), taxaSemanal: reaisTxt(t?.taxaSemanal ?? 500), parcelaIncluiServicos: !!t?.parcelaIncluiServicos,
    indiceReajuste: t?.indiceReajuste ?? '', multaAtrasoPct: t?.multaAtrasoPct?.toString() ?? '', jurosMensalPct: t?.jurosMensalPct?.toString() ?? '', garantiaDias: t?.garantiaDias?.toString() ?? '',
    observacoes: t?.observacoes ?? '',
  };
}
function termosDoForm(f: FormTermos): TermosContratoLegado {
  return {
    numeroOrigem: txtOuNull(f.numeroOrigem), dataAssinatura: txtOuNull(f.dataAssinatura), compradorNome: txtOuNull(f.compradorNome), compradorCpf: txtOuNull(f.compradorCpf),
    garantidorNome: txtOuNull(f.garantidorNome), garantidorCpf: txtOuNull(f.garantidorCpf),
    veiculo: {
      marca: txtOuNull(f.marca), modelo: txtOuNull(f.modelo), anoFabricacao: anoOuNull(f.anoFabricacao), anoModelo: anoOuNull(f.anoModelo), cor: txtOuNull(f.cor),
      placa: txtOuNull(f.placa), chassi: txtOuNull(f.chassi), renavam: txtOuNull(f.renavam), origem: txtOuNull(f.origem), combustivel: txtOuNull(f.combustivel), quilometragem: intOuNull(f.quilometragem),
    },
    valorTotal: centavosOuNull(f.valorTotal), entradaValor: centavosOuNull(f.entradaValor),
    parcelas: { total: centavosOuNull(f.parcTotal), quantidade: intOuNull(f.parcQuantidade), valor: centavosOuNull(f.parcValor), primeiraEm: txtOuNull(f.parcPrimeiraEm) },
    intermediarias: f.temIntermediarias ? { total: centavosOuNull(f.interTotal), quantidade: intOuNull(f.interQuantidade), valor: centavosOuNull(f.interValor), primeiraEm: txtOuNull(f.interPrimeiraEm) } : null,
    seguroSemanal: reaisParaCentavos(f.seguroSemanal || '0'), taxaSemanal: reaisParaCentavos(f.taxaSemanal || '0'), parcelaIncluiServicos: f.parcelaIncluiServicos,
    indiceReajuste: txtOuNull(f.indiceReajuste),
    multaAtrasoPct: f.multaAtrasoPct.trim() === '' ? null : parseFloat(f.multaAtrasoPct.replace(',', '.')),
    jurosMensalPct: f.jurosMensalPct.trim() === '' ? null : parseFloat(f.jurosMensalPct.replace(',', '.')),
    garantiaDias: intOuNull(f.garantiaDias), observacoes: txtOuNull(f.observacoes),
  };
}

export function MigracaoLegadoCasoPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_LEGADO);
  const caso = useQuery({ queryKey: ['legado-caso', id], queryFn: () => svc.caso(id), enabled: !!id });
  const c = caso.data;
  const editavel = podeOperar && (c?.status === 'COLETADO' || c?.status === 'EM_REVISAO');

  const [form, setForm] = useState<FormTermos>(formDosTermos(null));
  const [formSujo, setFormSujo] = useState(false);
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [descartando, setDescartando] = useState(false);
  const podeMigrar = pode(ROLE_MIGRAR);
  const [previa, setPrevia] = useState<PlanoMigracao | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [notaDiv, setNotaDiv] = useState<Record<string, string>>({});
  // Desfecho da divergência (doc 02 §26.9 item 6) — o que a F3 gera; a nota explica.
  const [desfechoDiv, setDesfechoDiv] = useState<Record<string, DesfechoDivergencia | ''>>({});
  const [ajuste, setAjuste] = useState<CobrancaLegada | null>(null);
  const [soDivergencias, setSoDivergencias] = useState(false);
  const [qtdAcordo, setQtdAcordo] = useState<Record<string, number>>({});
  const [chavesAcordo, setChavesAcordo] = useState<Record<string, string>>({});
  const [soDuvidas, setSoDuvidas] = useState(false);

  useEffect(() => {
    if (c && !formSujo) setForm(formDosTermos(c.termos));
    if (c) setObs(c.observacao ?? '');
  }, [c?.id, c?.termosAtualizadosEm, c?.observacao]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof FormTermos) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    setFormSujo(true);
  };

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      if (ok) toast.sucesso(ok);
      await Promise.all([qc.invalidateQueries({ queryKey: ['legado-caso', id] }), qc.invalidateQueries({ queryKey: ['legado-casos'] }), qc.invalidateQueries({ queryKey: ['legado-resumo'] })]);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvarTermos() {
    await rodar(async () => {
      const r = await svc.salvarTermos(id, termosDoForm(form));
      setFormSujo(false);
      if (r.faltantes.length) toast.info(`Termos salvos. Ainda faltam: ${r.faltantes.map((x) => CAMPO_ROTULO[x] ?? x).join(', ')}`);
    }, 'Termos salvos');
  }

  function anexarPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const arq = e.target.files?.[0];
    e.target.value = '';
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => rodar(async () => {
      const r = await svc.anexarPdf(id, arq.name, String(leitor.result));
      setFormSujo(false);
      if (r.erroLeitura) toast.info('PDF anexado, mas não consegui ler o texto — preencha os termos à mão');
      else if (!r.modeloReconhecido) toast.info('PDF anexado. Não é o modelo conhecido (Mod06) — confira os termos com atenção');
      else toast.info(`PDF lido: ${r.extraidos.length} campo(s) pré-preenchidos${r.faltantes.length ? `, faltam ${r.faltantes.length}` : ''}${r.cpfDiverge ? ' — ATENÇÃO: CPF do contrato difere do cliente no Asaas' : ''}`);
    }, 'PDF anexado');
    leitor.readAsDataURL(arq);
  }

  async function salvarObs() {
    if (!c || (c.observacao ?? '') === obs.trim()) return;
    try { await svc.anotar(id, obs); await qc.invalidateQueries({ queryKey: ['legado-casos'] }); } catch (e) { toast.erro(mensagemErro(e)); }
  }

  // Tipo escolhido pelo operador: decomposição proposta a partir dos termos.
  function mudarTipo(p: CobrancaLegada, tipo: TipoCobrancaLegada) {
    const t = c?.termos;
    const seguro = t?.seguroSemanal ?? 5000;
    const taxa = t?.taxaSemanal ?? 500;
    let corpo: { tipo: TipoCobrancaLegada; parcelamento: number; seguro: number; taxa: number; intermediaria: number };
    if (tipo === 'parcela' && p.valorOriginal > seguro + taxa) {
      const interV = t?.intermediarias?.valor ?? 0;
      const parc = t?.parcelas.valor ?? null;
      const inter = parc != null && interV > 0 && p.valorOriginal === parc + seguro + taxa + interV ? interV : 0;
      corpo = { tipo, seguro, taxa, intermediaria: inter, parcelamento: p.valorOriginal - seguro - taxa - inter };
    } else {
      corpo = { tipo, seguro: 0, taxa: 0, intermediaria: 0, parcelamento: p.valorOriginal };
    }
    return rodar(() => svc.definirInterpretacao(id, p.id, corpo), '');
  }
  function confirmarProposta(p: CobrancaLegada) {
    const i = p.interpretacao;
    if (!i) return;
    return rodar(() => svc.definirInterpretacao(id, p.id, { tipo: i.tipo, parcelamento: i.parcelamento, seguro: i.seguro, taxa: i.taxa, intermediaria: i.intermediaria, extra: i.extra, extraRotulo: i.extraRotulo ?? undefined, encargo: i.encargo }), '');
  }

  const reconhecidas = useMemo(() => new Map((c?.divergenciasReconhecidas ?? []).map((d) => [d.chave, d])), [c?.divergenciasReconhecidas]);
  const cobrancaPorId = useMemo(() => new Map((c?.cobrancas ?? []).map((p) => [p.id, p])), [c?.cobrancas]);
  const vinculoPorCobranca = useMemo(() => new Map((c?.vinculosManuais ?? []).map((v) => [v.cobrancaId, v])), [c?.vinculosManuais]);

  if (!c) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{caso.isError ? mensagemErro(caso.error) : 'Carregando…'}</div>;

  const conc = c.conciliacao;
  const r = conc.resumo;
  const linhas = soDivergencias ? conc.linhas.filter((l) => l.divergencia) : conc.linhas;
  const cobrancas = soDuvidas ? c.cobrancas.filter((p) => p.duvida) : c.cobrancas;

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Cabeçalho */}
      <div className="rounded-[12px] p-[14px]" style={bloco}>
        <div className="flex flex-wrap items-start justify-between gap-[10px]">
          <div className="min-w-0">
            <Link to="/migracao-legado" className="text-[11.5px] underline" style={{ color: 'var(--text-muted)' }}>← Migração do legado</Link>
            <div className="mt-[4px] flex flex-wrap items-center gap-[8px]">
              <span className="font-display text-[17px] font-bold" style={{ color: 'var(--text-primary)' }}>{c.nome}</span>
              <StatusBadge label={c.statusRotulo} colors={{ [c.statusRotulo]: CASO_LEGADO_STATUS_COLORS[c.status] }} />
              <StatusBadge label={c.situacaoRotulo} colors={{ [c.situacaoRotulo]: SITUACAO_LEGADO_COLORS[c.situacao] }} />
              {c.recente && <span className="text-[11px] font-semibold" style={{ color: CASO_LEGADO_STATUS_COLORS.VALIDADO.fg }}>recente · sem parcela paga</span>}
            </div>
            <div className="mt-[3px] text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {cpfBR(c.cpfCnpj)} · {c.telefone ?? 'sem telefone'} · {c.email ?? 'sem e-mail'} · Asaas <b>{c.asaasCustomerId}</b> · lido em {dataHoraBR(c.coletadoEm)}
            </div>
          </div>
          {podeOperar && (
            <div className="flex flex-wrap items-center gap-[8px]">
              {c.status === 'COLETADO' && <button className={btn} style={btnPri} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'EM_REVISAO'), 'Caso em revisão')}>Começar a revisão</button>}
              {c.status === 'EM_REVISAO' && (
                <button className={btn} style={c.pendenciasParaValidar.length ? btnSec : btnPri} disabled={ocupado || c.pendenciasParaValidar.length > 0}
                  title={c.pendenciasParaValidar.length ? 'Resolva as pendências abaixo' : 'Caso conciliado — pronto para migrar (F3)'}
                  onClick={() => rodar(() => svc.validar(id), 'Caso validado')}>Validar caso</button>
              )}
              {c.status === 'EM_REVISAO' && <button className={btn} style={btnSec} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'COLETADO'), 'Caso devolvido à fila')}>Devolver à fila</button>}
              {c.status === 'VALIDADO' && podeMigrar && (
                <button className={btn} style={btnPri} disabled={ocupado || carregandoPrevia} title="Gera titular, veículo, contrato e cronograma no sistema e para a assinatura no Asaas"
                  onClick={async () => { setCarregandoPrevia(true); try { setPrevia(await svc.previaMigracao(id)); } catch (e) { toast.erro(mensagemErro(e)); } finally { setCarregandoPrevia(false); } }}>
                  {carregandoPrevia ? 'Preparando prévia…' : 'Migrar para o sistema'}
                </button>
              )}
              {c.status === 'VALIDADO' && <button className={btn} style={btnSec} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'EM_REVISAO'), 'Caso reaberto')}>Reabrir (voltar à revisão)</button>}
              {(c.status === 'COLETADO' || c.status === 'EM_REVISAO') && !descartando && <button className={btn} style={btnSec} disabled={ocupado} onClick={() => setDescartando(true)}>Descartar</button>}
              {c.status === 'DESCARTADO' && <button className={btn} style={btnSec} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'COLETADO'), 'Caso de volta à fila')}>Voltar para a fila</button>}
            </div>
          )}
        </div>
        {descartando && (
          <div className="mt-[10px] flex flex-wrap items-center gap-[8px] rounded-[10px] p-[10px]" style={{ background: CASO_LEGADO_STATUS_COLORS.DESCARTADO.bg }}>
            <input className={`${inputCls} min-w-[280px] flex-1`} style={inputStyle} placeholder="Por que descartar? (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button className={btn} style={{ background: CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg, color: '#fff' }} disabled={ocupado || !motivo.trim()} onClick={() => rodar(() => svc.mudarStatus(id, 'DESCARTADO', motivo), 'Caso descartado').then(() => setDescartando(false))}>Confirmar descarte</button>
            <button className={btn} style={btnSec} onClick={() => setDescartando(false)}>Cancelar</button>
          </div>
        )}
        {c.status === 'EM_REVISAO' && c.pendenciasParaValidar.length > 0 && (
          <div className="mt-[10px] rounded-[10px] p-[10px] text-[12px]" style={{ background: CASO_LEGADO_STATUS_COLORS.EM_REVISAO.bg, color: CASO_LEGADO_STATUS_COLORS.EM_REVISAO.fg }}>
            <b>Para validar, ainda falta:</b>
            <ul className="mt-[3px] list-disc pl-[18px]">{c.pendenciasParaValidar.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {c.status === 'VALIDADO' && <div className="mt-[10px] text-[12px]" style={{ color: CASO_LEGADO_STATUS_COLORS.MIGRADO.fg }}>Validado em {dataHoraBR(c.validadoEm)}. "Migrar para o sistema" cria o contrato em produção e para a assinatura no Asaas — um caso por vez.</div>}
        {c.status === 'MIGRADO' && c.migracao && (
          <div className="mt-[10px] rounded-[10px] p-[10px] text-[12px]" style={{ background: CASO_LEGADO_STATUS_COLORS.MIGRADO.bg, color: CASO_LEGADO_STATUS_COLORS.MIGRADO.fg }}>
            <b>Migrado em {dataHoraBR(c.migracao.em)}.</b>{' '}
            {c.contratoId && <Link to={`/contratos/${c.contratoId}`} className="underline">contrato {c.migracao.resumo?.contratoNumero ?? ''}</Link>}
            {c.titularId && <> · <Link to={`/titulares/${c.titularId}`} className="underline">titular</Link></>}
            {c.migracao.resumo && <> · {c.migracao.resumo.faturas ?? 0} faturas ({c.migracao.resumo.faturasPagas ?? 0} pagas, {c.migracao.resumo.faturasFechadas ?? 0} vencidas mantidas, {c.migracao.resumo.faturasAbertas ?? 0} a emitir) · {c.migracao.resumo.reembolsos ?? 0} reembolso(s) · {c.migracao.resumo.avulsas ?? 0} avulsa(s){c.migracao.resumo.pdfCopiado === false ? ' · PDF não copiado' : ''}{c.migracao.resumo.cobrancasApagadas != null && <> · {c.migracao.resumo.cobrancasApagadas} cobrança(s) antiga(s) apagada(s), {c.migracao.resumo.emitidasAgora ?? 0} emitida(s) na hora</>}</>}
            <div className="mt-[4px]">
              {(c.migracao.resumo?.orfasApagadas ?? 0) > 0 && <>{c.migracao.resumo?.orfasApagadas} cobrança(s) órfã(s) da assinatura apagada(s). </>}
              {podeMigrar && <button className="mr-[10px] underline" disabled={ocupado} title="Grava a taxa de desconto vigente no contrato e a FIPE oficial no veículo, só onde estiver vazio" onClick={() => rodar(async () => { const r = await svc.completar(id); if (r.fipeMotivo) toast.erro(`FIPE não preenchida: ${r.fipeMotivo}`); else toast.sucesso(`${r.taxaGravada ? 'Taxa gravada. ' : ''}${r.fipeGravada && r.fipe ? `FIPE ${formatCurrency(r.fipe.valor)} (${r.fipe.modeloFipe}, ${r.fipe.referencia}).` : 'FIPE já estava preenchida.'}`); return r; }, '')}>Completar taxa e FIPE</button>}
              {podeMigrar && <button className="underline" disabled={ocupado} title="Apaga no Asaas cobranças a vencer que a assinatura antiga emitiu depois da coleta (sem referência do sistema)" onClick={() => rodar(async () => { const r = await svc.limparCobrancasOrfas(id); if (r.erro) toast.erro(`Falha ao apagar órfã: ${r.erro}`); return r; }, 'Cobranças órfãs verificadas')}>Verificar cobranças órfãs no Asaas</button>}
            </div>
            {c.migracao.resumo?.cobrancasMantidas && c.migracao.resumo.cobrancasMantidas.length > 0 && <div className="mt-[4px]" style={{ color: SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}><b>{c.migracao.resumo.cobrancasMantidas.length} cobrança(s) a vencer não foram apagadas</b> e continuam amarradas à cobrança antiga: {c.migracao.resumo.cobrancasMantidas.map((m) => dataBR(m.vencimento)).join(', ')}.</div>}
            <div className="mt-[4px]">
              {!c.migracao.assinaturaId ? 'Sem assinatura no Asaas para parar.'
                : c.migracao.assinaturaParadaEm ? `Assinatura do Asaas parada em ${dataHoraBR(c.migracao.assinaturaParadaEm)} — o sistema assume a emissão.`
                : <span style={{ color: SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}><b>Assinatura do Asaas AINDA ATIVA</b>{c.migracao.assinaturaParadaErro ? ` — ${c.migracao.assinaturaParadaErro}` : ''}. {podeMigrar && <button className="underline" disabled={ocupado} onClick={() => rodar(() => svc.pararAssinatura(id), 'Assinatura parada')}>Parar assinatura agora</button>}</span>}
            </div>
          </div>
        )}
      </div>

      {previa && (
        <Modal open onClose={() => setPrevia(null)} title={`Migrar para o sistema — ${c.nome}`} largura={640}>
          <div className="flex flex-col gap-[8px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            <div>Nada foi gravado ainda. Confira o que vai nascer e confirme. A operação é uma só e, no fim, a assinatura do Asaas é parada (as cobranças já emitidas são preservadas).</div>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                <tr><td className={td}>Titular</td><td className={td}>{previa.titular.existente ? <>já existe: <b>{previa.titular.existente.nome}</b> (reaproveitado)</> : <>novo: <b>{previa.titular.nome}</b> · {cpfBR(previa.titular.cpfCnpj)}</>}</td></tr>
                <tr><td className={td}>Veículo</td><td className={td}>{previa.veiculo.existente ? <>já cadastrado: <b>{previa.veiculo.existente.descricao}</b></> : <>novo: <b>{previa.veiculo.descricao}</b>{previa.veiculo.placa ? ` · ${previa.veiculo.placa}` : ''}</>} · estrutura Azit</td></tr>
                <tr><td className={td}>Contrato</td><td className={td}><b>{previa.contrato.numero}</b> · assinado em {dataBR(previa.contrato.dataAssinatura)} · {previa.contrato.numeroParcelas}× {formatCurrency(previa.contrato.valorParcela)} a partir de {dataBR(previa.contrato.dataPrimeiraParcela)} · total {formatCurrency(previa.contrato.valorTotal)} · vencimentos {previa.contrato.modoVencimentos === 'ASAAS' ? 'das cobranças do Asaas' : 'do contrato'}</td></tr>
                <tr><td className={td}>FIPE do veículo</td><td className={td}>{previa.veiculo.fipe ? <><b>{formatCurrency(previa.veiculo.fipe.valor)}</b> · {previa.veiculo.fipe.modeloFipe} {previa.veiculo.fipe.anoModelo} · código {previa.veiculo.fipe.codigoFipe} · {previa.veiculo.fipe.referencia} (fonte oficial){previa.veiculo.fipe.alternativas.length > 0 && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>outros modelos próximos: {previa.veiculo.fipe.alternativas.join(' · ')}</div>}</> : previa.veiculo.fipeMotivo ? <span style={{ color: SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}>não preenchida — {previa.veiculo.fipeMotivo}. Corrija marca/modelo/ano nos termos; sem FIPE a novação não calcula a proteção.</span> : 'veículo já tem valor de venda'}</td></tr>
                <tr><td className={td}>Taxa de desconto</td><td className={td}>{previa.contrato.taxaDescontoMensal ? <>{(previa.contrato.taxaDescontoMensal * 100).toFixed(2).replace('.', ',')}% ao mês — a mesma dos contratos gerados hoje (antecipação e novação)</> : <span style={{ color: SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}>não definida — sem taxa vigente no Catálogo</span>}</td></tr>
                <tr><td className={td}>Entrada</td><td className={td}>{previa.entrada ? <>{formatCurrency(previa.entrada.valor)} paga em {dataBR(previa.entrada.pagoEm)}</> : 'sem entrada'}</td></tr>
                <tr><td className={td}>Faturas</td><td className={td}>{previa.faturas.length} no total: <b>{previa.resumo.faturasPagas}</b> pagas, <b>{previa.resumo.faturasFechadas}</b> vencidas com a cobrança antiga mantida, <b>{previa.resumo.faturasAbertas}</b> a emitir pelo sistema</td></tr>
                <tr><td className={td}>Cobranças a vencer</td><td className={td}>{previa.resumo.substituidas === 0 ? 'nenhuma emitida pela assinatura' : <><b>{previa.resumo.substituidas}</b> serão apagadas no Asaas e substituídas pelas do sistema{previa.resumo.emitidasAgora > 0 && <>, <b>{previa.resumo.emitidasAgora}</b> emitida(s) na hora por vencerem em até 5 dias</>}</>}</td></tr>
                <tr><td className={td}>Reembolsos Parcelados</td><td className={td}>{previa.rps.length === 0 ? 'nenhum' : previa.rps.map((r) => `${r.rotulo} (${r.parcelas.length}×)`).join(' · ')}</td></tr>
                <tr><td className={td}>Cobranças avulsas</td><td className={td}>{previa.resumo.avulsas}</td></tr>
                <tr><td className={td}>Encargos já pagos</td><td className={td}>{formatCurrency(previa.resumo.encargos)}</td></tr>
                <tr><td className={td}>Assinatura do Asaas</td><td className={td}>{previa.resumo.assinaturaId ? `${previa.resumo.assinaturaId} será PARADA (INACTIVE)` : 'nenhuma'}</td></tr>
              </tbody>
            </table>
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setPrevia(null)}>Cancelar</button>
              <button className={btn} style={btnPri} disabled={ocupado} onClick={() => { const p = previa; setPrevia(null); void rodar(async () => { const r = await svc.migrar(id); if (!r.assinatura.parada) toast.erro(`Contrato ${r.contratoNumero} criado, mas a assinatura do Asaas não foi parada: ${r.assinatura.motivo}`); if (r.substituicao?.mantidas?.length) toast.erro(`${r.substituicao.mantidas.length} cobrança(s) a vencer não foram apagadas no Asaas e ficaram amarradas`); return r; }, `Caso migrado — contrato ${p.contrato.numero}`); }}>Confirmar migração</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Termos + Asaas */}
      <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-[3fr_2fr]">
        {/* Termos */}
        <div className="rounded-[12px] p-[14px]" style={bloco}>
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Termos do contrato (PopHub)</div>
            <div className="flex items-center gap-[8px]">
              {c.pdf ? (
                <a href={svc.urlPdf(id)} target="_blank" rel="noreferrer" className="text-[11.5px] underline" style={{ color: 'var(--accent)' }}>abrir PDF ({c.pdf.nome})</a>
              ) : (
                <span className="text-[11.5px]" style={{ color: CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg }}>sem PDF</span>
              )}
              {editavel && (
                <label className={`${btn} flex cursor-pointer items-center`} style={btnSec}>
                  {c.pdf ? 'Trocar PDF' : 'Anexar PDF do contrato'}
                  <input type="file" accept="application/pdf" className="hidden" onChange={anexarPdf} disabled={ocupado} />
                </label>
              )}
            </div>
          </div>
          {c.extracaoPdf && (
            <div className="mt-[6px] text-[11px]" style={{ color: c.extracaoPdf.cpfDiverge ? CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg : 'var(--text-muted)' }}>
              {c.extracaoPdf.erro ? `Leitura do PDF falhou: ${c.extracaoPdf.erro}` : c.extracaoPdf.modeloReconhecido ? `Modelo Mod06 reconhecido — ${c.extracaoPdf.extraidos.length} campo(s) lidos do PDF.` : 'PDF de outro modelo — termos preenchidos à mão.'}
            </div>
          )}
          {c.contratoDeOutroCliente && (
            <div className="mt-[8px] rounded-[10px] p-[10px] text-[12px]" style={{ background: CASO_LEGADO_STATUS_COLORS.DESCARTADO.bg, color: CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg }}>
              <div className="font-bold">Este contrato é de outro cliente</div>
              <div className="mt-[2px]">
                O contrato é de <b>{c.contratoDeOutroCliente.nomeContrato ?? 'comprador sem nome'}</b> (CPF {cpfBR(c.contratoDeOutroCliente.cpfContrato)}), mas as cobranças deste caso são de <b>{c.nome}</b> (CPF {cpfBR(c.cpfCnpj)}) no Asaas. O caso não pode ser validado assim.
              </div>
              {c.contratoDeOutroCliente.casos.length === 0 && (
                <div className="mt-[6px]">Nenhum cliente lido do Asaas tem exatamente o CPF {cpfBR(c.contratoDeOutroCliente.cpfContrato)}. Confira o CPF no cadastro do Asaas e leia o Asaas de novo na fila — ou retire o contrato deste caso.</div>
              )}
              {c.contratoDeOutroCliente.casos.map((d) => (
                <div key={d.id} className="mt-[6px] flex flex-wrap items-center gap-[8px]">
                  <span>Cliente do Asaas com este CPF: <Link to={`/migracao-legado/${d.id}`} className="font-bold underline">{d.nome}</Link> · {d.asaasCustomerId} · {d.cobrancasPagas} paga(s) de {d.totalCobrancas} cobrança(s)</span>
                  {editavel && !d.temContrato && !d.fechado && (
                    <button className={btn} style={btnPri} disabled={ocupado}
                      onClick={() => { if (window.confirm(`Mover o PDF e os termos para o caso de ${d.nome}? Este caso fica sem contrato.`)) void rodar(() => svc.moverContrato(id, d.id), `Contrato movido para o caso de ${d.nome}`); }}>
                      Mover o contrato para este caso
                    </button>
                  )}
                  {d.temContrato && <span>— já tem contrato anexado; abra e confira.</span>}
                  {!d.temContrato && d.fechado && <span>— caso já validado ou migrado.</span>}
                </div>
              ))}
              {editavel && (
                <div className="mt-[8px]">
                  <button className={btn} style={btnSec} disabled={ocupado}
                    onClick={() => { if (window.confirm('Retirar o PDF e os termos deste caso? As cobranças lidas do Asaas ficam.')) void rodar(() => svc.retirarContrato(id), 'Contrato retirado deste caso'); }}>
                    Retirar o contrato deste caso
                  </button>
                </div>
              )}
            </div>
          )}
          <fieldset disabled={!editavel} className="mt-[10px] grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:grid-cols-4">
            <Campo rotulo="Nº do contrato *"><input className={inputCls} style={inputStyle} value={form.numeroOrigem} onChange={set('numeroOrigem')} /></Campo>
            <Campo rotulo="Assinatura *"><input type="date" className={inputCls} style={inputStyle} value={form.dataAssinatura} onChange={set('dataAssinatura')} /></Campo>
            <Campo rotulo="Comprador"><input className={inputCls} style={inputStyle} value={form.compradorNome} onChange={set('compradorNome')} /></Campo>
            <Campo rotulo="CPF do comprador *"><input className={inputCls} style={inputStyle} value={form.compradorCpf} onChange={set('compradorCpf')} /></Campo>
            <Campo rotulo="Garantidor"><input className={inputCls} style={inputStyle} value={form.garantidorNome} onChange={set('garantidorNome')} placeholder="quando houver" /></Campo>
            <Campo rotulo="CPF do garantidor"><input className={inputCls} style={inputStyle} value={form.garantidorCpf} onChange={set('garantidorCpf')} /></Campo>
            <div className="col-span-full mt-[4px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Veículo (cláusula 2.1)</div>
            <Campo rotulo="Marca"><input className={inputCls} style={inputStyle} value={form.marca} onChange={set('marca')} /></Campo>
            <Campo rotulo="Modelo"><input className={inputCls} style={inputStyle} value={form.modelo} onChange={set('modelo')} /></Campo>
            <Campo rotulo="Ano fab."><input className={inputCls} style={inputStyle} value={form.anoFabricacao} onChange={set('anoFabricacao')} /></Campo>
            <Campo rotulo="Ano modelo"><input className={inputCls} style={inputStyle} value={form.anoModelo} onChange={set('anoModelo')} /></Campo>
            <Campo rotulo="Placa *"><input className={inputCls} style={inputStyle} value={form.placa} onChange={set('placa')} /></Campo>
            <Campo rotulo="Chassi *"><input className={inputCls} style={inputStyle} value={form.chassi} onChange={set('chassi')} /></Campo>
            <Campo rotulo="RENAVAM"><input className={inputCls} style={inputStyle} value={form.renavam} onChange={set('renavam')} /></Campo>
            <Campo rotulo="Cor"><input className={inputCls} style={inputStyle} value={form.cor} onChange={set('cor')} /></Campo>
            <Campo rotulo="Origem"><input className={inputCls} style={inputStyle} value={form.origem} onChange={set('origem')} placeholder="locadora / particular…" /></Campo>
            <Campo rotulo="Combustível"><input className={inputCls} style={inputStyle} value={form.combustivel} onChange={set('combustivel')} /></Campo>
            <Campo rotulo="Km"><input className={inputCls} style={inputStyle} value={form.quilometragem} onChange={set('quilometragem')} /></Campo>
            <div className="col-span-full mt-[4px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Valores (cláusula 3) — o valor da parcela é SÓ o parcelamento (ex.: 942), sem seguro e taxa</div>
            <Campo rotulo="Valor total (3.1) *"><input className={inputCls} style={inputStyle} value={form.valorTotal} onChange={set('valorTotal')} placeholder="0,00" /></Campo>
            <Campo rotulo="Entrada no ato (3.2 a) *"><input className={inputCls} style={inputStyle} value={form.entradaValor} onChange={set('entradaValor')} placeholder="0,00" /></Campo>
            <Campo rotulo="Nº de parcelas *"><input className={inputCls} style={inputStyle} value={form.parcQuantidade} onChange={set('parcQuantidade')} /></Campo>
            <Campo rotulo="Valor da parcela *"><input className={inputCls} style={inputStyle} value={form.parcValor} onChange={set('parcValor')} placeholder="942,00" /></Campo>
            <Campo rotulo="1ª parcela *"><input type="date" className={inputCls} style={inputStyle} value={form.parcPrimeiraEm} onChange={set('parcPrimeiraEm')} /></Campo>
            <Campo rotulo="Total parcelado"><input className={inputCls} style={inputStyle} value={form.parcTotal} onChange={set('parcTotal')} placeholder="0,00" /></Campo>
            <label className="col-span-2 flex items-center gap-[6px] self-end pb-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
              <input type="checkbox" checked={form.temIntermediarias} onChange={set('temIntermediarias')} /> tem parcelas intermediárias (entrada diluída, 3.2 c)
            </label>
            {/* Contrato cuja parcela já vem cheia (decisão 02/10): 997 = 942 + 50 + 5. */}
            <label className="col-span-full flex items-center gap-[6px] text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form.parcelaIncluiServicos} onChange={set('parcelaIncluiServicos')} /> o valor da parcela do contrato <b>já inclui</b> seguro e taxa (ex.: R$ 997,00) — o parcelamento passa a ser o valor menos os dois
            </label>
            {form.temIntermediarias && (
              <>
                <Campo rotulo="Qtde intermediárias"><input className={inputCls} style={inputStyle} value={form.interQuantidade} onChange={set('interQuantidade')} /></Campo>
                <Campo rotulo="Valor de cada"><input className={inputCls} style={inputStyle} value={form.interValor} onChange={set('interValor')} placeholder="500,00" /></Campo>
                <Campo rotulo="1ª intermediária"><input type="date" className={inputCls} style={inputStyle} value={form.interPrimeiraEm} onChange={set('interPrimeiraEm')} /></Campo>
                <Campo rotulo="Total intermediárias"><input className={inputCls} style={inputStyle} value={form.interTotal} onChange={set('interTotal')} placeholder="0,00" /></Campo>
              </>
            )}
            <div className="col-span-full mt-[4px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Itens junto da parcela (§26.2) e encargos</div>
            <Campo rotulo="Seguro / semana"><input className={inputCls} style={inputStyle} value={form.seguroSemanal} onChange={set('seguroSemanal')} /></Campo>
            <Campo rotulo="Taxa mensagens / semana"><input className={inputCls} style={inputStyle} value={form.taxaSemanal} onChange={set('taxaSemanal')} /></Campo>
            <Campo rotulo="Reajuste"><input className={inputCls} style={inputStyle} value={form.indiceReajuste} onChange={set('indiceReajuste')} placeholder="IPCA" /></Campo>
            <Campo rotulo="Multa atraso %"><input className={inputCls} style={inputStyle} value={form.multaAtrasoPct} onChange={set('multaAtrasoPct')} placeholder="2" /></Campo>
            <Campo rotulo="Juros % a.m."><input className={inputCls} style={inputStyle} value={form.jurosMensalPct} onChange={set('jurosMensalPct')} placeholder="1" /></Campo>
            <Campo rotulo="Garantia (dias)"><input className={inputCls} style={inputStyle} value={form.garantiaDias} onChange={set('garantiaDias')} placeholder="90" /></Campo>
            <div className="col-span-full"><Campo rotulo="Observações dos termos"><textarea className={inputCls} style={inputStyle} rows={2} value={form.observacoes} onChange={set('observacoes')} /></Campo></div>
          </fieldset>
          {editavel && (
            <div className="mt-[10px] flex items-center gap-[10px]">
              <button className={btn} style={btnPri} disabled={ocupado || !formSujo} onClick={salvarTermos}>Salvar termos</button>
              {c.termosFaltantes.length > 0 && <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>faltam: {c.termosFaltantes.map((x) => CAMPO_ROTULO[x] ?? x).join(', ')}</span>}
            </div>
          )}
        </div>

        {/* Asaas + resumo */}
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-[12px] p-[14px]" style={bloco}>
            <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Assinatura no Asaas (recorrência)</div>
            {c.assinatura ? (
              <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
                <div><b>{formatCurrency(c.assinatura.valor ?? 0)}</b> {c.assinatura.ciclo === 'WEEKLY' ? 'semanal' : c.assinatura.ciclo} · {c.assinatura.status === 'ACTIVE' ? 'ativa' : (c.assinatura.status ?? '').toLowerCase()} · próxima {dataBR(c.assinatura.proximoVencimento)}</div>
                <div className="mt-[3px] text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{c.assinatura.descricao ?? 'sem descrição'}</div>
              </div>
            ) : <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Sem assinatura — cobranças avulsas.</div>}
            <div className="mt-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              Parcela padrão cobrada: <b>{c.valorParcelaPadrao == null ? '—' : formatCurrency(c.valorParcelaPadrao)}</b> {c.modeloRotulo ? `· ${c.modeloRotulo}` : ''}
              {c.decomposicao && <> · proposta {formatCurrency(c.decomposicao.parcelamento)} + {formatCurrency(c.decomposicao.seguro)} + {formatCurrency(c.decomposicao.taxaMensagens)}</>}
            </div>
          </div>
          <div className="rounded-[12px] p-[14px]" style={bloco}>
            <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Conciliação — resumo</div>
            {conc.incompleta ? (
              <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Preencha nº de parcelas, valor e 1ª parcela nos termos para o cronograma esperado nascer.</div>
            ) : (
              <div className="mt-[8px] grid grid-cols-2 gap-[8px] sm:grid-cols-3">
                <Metrica label="Parcelas pagas" valor={`${r.parcelasPagas} de ${r.parcelasEsperadas}`} />
                <Metrica label="Pendentes / vencidas" valor={`${r.parcelasPendentes} / ${r.parcelasVencidas}`} alerta={r.parcelasVencidas > 0} />
                <Metrica label="Futuras (não emitidas)" valor={r.parcelasFuturas} />
                <Metrica label="Saldo contratual" valor={formatCurrency(r.saldoContratualRestante)} />
                <Metrica label="Encargos já pagos" valor={formatCurrency(r.encargosPagos)} />
                <Metrica label="Divergências" valor={r.divergencias} alerta={r.divergencias > 0} />
                {r.intermediariasEsperadas > 0 && <Metrica label="Intermediárias pagas" valor={`${r.intermediariasPagas} de ${r.intermediariasEsperadas}`} />}
                <Metrica label="Entrada" valor={r.entradaPaga === null ? 'fora do Asaas' : r.entradaPaga ? 'paga' : 'em aberto'} />
                <Metrica label="Fora do cronograma" valor={r.cobrancasForaDoCronograma} />
                <Metrica label="Conferir / decidir" valor={`${r.linhasConferir} / ${r.linhasDecidir}`} alerta={r.linhasDecidir > 0} />
                {r.acordosSemConfirmar > 0 && <Metrica label="Acordos a confirmar" valor={r.acordosSemConfirmar} alerta />}
                {conc.modo === 'SEQUENCIA' && r.deslocamentoSemanas !== 0 && <Metrica label="Cronograma deslocado" valor={`${r.deslocamentoSemanas} semana(s)`} />}
              </div>
            )}
            {/* Doc 02 §26.14: parcela N = N-ésima cobrança (sequência) ou cobrança na data do contrato. */}
            {!conc.incompleta && (
              <div className="mt-[10px] flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold">Como achar cada parcela:</span>
                <select className="rounded-[6px] px-[6px] py-[3px] text-[12px]" style={inputStyle} disabled={!editavel} value={c.modoConciliacao}
                  onChange={(e) => rodar(() => svc.definirModoConciliacao(id, e.target.value as ModoConciliacao), 'Método de conciliação definido')}>
                  <option value="SEQUENCIA">pela sequência das cobranças (semana pulada não consome parcela; recomendado)</option>
                  <option value="DATA">pela data do contrato (±3 dias; método antigo)</option>
                </select>
              </div>
            )}
            {/* Doc 02 §26.9 item 4: vencimentos do contrato ou das cobranças reais — escolha POR CASO, sem regra. */}
            {!conc.incompleta && (
              <div className="mt-[10px] flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold">Vencimentos na migração:</span>
                <select className="rounded-[6px] px-[6px] py-[3px] text-[12px]" style={inputStyle} disabled={!editavel} value={c.modoVencimentos}
                  onChange={(e) => rodar(() => svc.definirModoVencimentos(id, e.target.value as ModoVencimentos), 'Vencimentos definidos')}>
                  <option value="CONTRATO">do contrato (parcela na data do cronograma; fatura na data real)</option>
                  <option value="ASAAS">das cobranças do Asaas (parcela na data real; futuras seguem o dia da semana da última)</option>
                </select>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Use "das cobranças" quando o dia da semana foi mudado com o cliente e o cronograma do contrato pareceria atrasado.</span>
              </div>
            )}
          </div>
          <div className="rounded-[12px] p-[14px]" style={bloco}>
            <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Anotações do caso</div>
            <textarea className={`${inputCls} mt-[6px]`} style={inputStyle} rows={3} value={obs} onChange={(e) => setObs(e.target.value)} onBlur={salvarObs} disabled={!podeOperar}
              placeholder="O que achou no PopHub, dúvidas, combinados com o cliente…" />
          </div>
        </div>
      </div>

      {/* Acordos legados (doc 02 §26.14): o sistema agrupa as (k/n), soma e propõe o que quitam. */}
      {!conc.incompleta && conc.acordos.length > 0 && (
        <div className="rounded-[12px] p-[14px]" style={bloco}>
          <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Acordos encontrados nas cobranças ({conc.acordos.length}) — acordo cobre parcela antiga vencida, nunca empurra o cronograma</div>
          <ul className="mt-[8px] flex flex-col gap-[8px]">
            {conc.acordos.map((g) => (
              <li key={g.id} className="rounded-[10px] p-[10px] text-[12px]" style={{ border: '1px solid var(--border)', background: g.confirmado ? CASO_LEGADO_STATUS_COLORS.MIGRADO.bg : CASO_LEGADO_STATUS_COLORS.EM_REVISAO.bg }}>
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  <div>
                    <b>{g.rotulo}</b> · {g.parcelas.length} parcela(s) · total <b className="tabular-nums">{formatCurrency(g.total)}</b>
                    {g.concluido ? ' · todas pagas' : ` · pago ${formatCurrency(g.pago)} (em andamento)`}
                  </div>
                  {g.confirmado
                    ? <span className="flex items-center gap-[8px]" style={{ color: CASO_LEGADO_STATUS_COLORS.MIGRADO.fg }}>
                        <b>Confirmado: cobre {g.confirmado.quantidade} parcela(s){g.confirmado.chaves.length ? ` (${g.confirmado.chaves.map((k) => k.replace('parcela:', '')).join(', ')})` : ''}</b>
                        {editavel && <button className="underline" onClick={() => rodar(() => svc.desfazerAcordo(id, g.id), 'Confirmação desfeita')}>desfazer</button>}
                      </span>
                    : editavel && (
                      <span className="flex flex-wrap items-center gap-[6px]">
                        <label className="flex items-center gap-[4px]">cobre
                          <input type="number" min={1} className="w-[52px] rounded-[6px] px-[6px] py-[3px] text-[12px] tabular-nums" style={inputStyle} value={qtdAcordo[g.id] ?? g.proposta.quantidade} onChange={(e) => setQtdAcordo({ ...qtdAcordo, [g.id]: Math.max(1, Number(e.target.value) || 1) })} />
                          parcela(s)</label>
                        {conc.modo === 'DATA' && (
                          <input className="w-[200px] rounded-[6px] px-[6px] py-[3px] text-[12px]" style={inputStyle} placeholder={g.proposta.chaves.map((k) => k.replace('parcela:', '')).join(', ') || 'nº das parcelas (ex.: 5, 6)'} value={chavesAcordo[g.id] ?? ''} onChange={(e) => setChavesAcordo({ ...chavesAcordo, [g.id]: e.target.value })} />
                        )}
                        <button className={btn} style={btnPri} disabled={ocupado}
                          onClick={() => rodar(() => svc.confirmarAcordo(id, g.id, { quantidade: qtdAcordo[g.id] ?? g.proposta.quantidade, chaves: conc.modo === 'DATA' ? ((chavesAcordo[g.id] ?? '').split(/[,\s]+/).filter(Boolean).map((n) => `parcela:${n}`)) : undefined }), 'Acordo confirmado')}>
                          Confirmar
                        </button>
                      </span>
                    )}
                </div>
                <div className="mt-[4px]" style={{ color: 'var(--text-secondary)' }}>{g.proposta.texto}</div>
                <div className="mt-[4px] text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {g.parcelas.map((x) => `${dataBR(x.vencimento)} ${formatCurrency(x.valor)}${x.k != null ? ` (${x.k}/${x.n})` : ''}${x.classe === 'paga' ? '' : ` [${x.classe}]`}${x.dentroDeParcela ? ' junto da parcela' : ''}`).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conciliação */}
      {!conc.incompleta && (
        <div className="rounded-[12px] p-[14px]" style={bloco}>
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Conciliação — cronograma esperado × cobranças reais ({conc.linhas.length} linhas)</div>
            <label className="flex items-center gap-[6px] text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={soDivergencias} onChange={(e) => setSoDivergencias(e.target.checked)} /> só divergências
            </label>
          </div>
          <div className="mt-[8px] max-h-[420px] overflow-auto rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
                <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th className={th}></th><th className={th}>Item</th><th className={th}>Esperado em</th><th className={`${th} text-right`}>Esperado</th>
                  <th className={th}>Cobrado em</th><th className={`${th} text-right`}>Cobrado</th><th className={th}>Pago em</th><th className={`${th} text-right`}>Pago</th>
                  <th className={`${th} text-right`}>Encargo</th><th className={th}>Situação</th><th className={th}>Divergência</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => <LinhaConc key={l.chave} l={l} reconhecida={reconhecidas.get(l.chave) ?? null} editavel={!!editavel} nota={notaDiv[l.chave] ?? ''} setNota={(v) => setNotaDiv({ ...notaDiv, [l.chave]: v })}
                  desfecho={desfechoDiv[l.chave] ?? ''} setDesfecho={(v) => setDesfechoDiv({ ...desfechoDiv, [l.chave]: v })} desfechos={c.desfechosDivergencia.filter((d) => d.valor !== 'COBRANCA_AVULSA')}
                  reconhecer={() => rodar(() => svc.reconhecerDivergencia(id, l.chave, notaDiv[l.chave] ?? '', desfechoDiv[l.chave] ?? ''), 'Divergência reconhecida')}
                  desfazer={() => rodar(() => svc.desfazerReconhecimento(id, l.chave), '')}
                  vinculadas={[...(l.partes.length ? l.partes.map((x) => x.cobrancaId) : l.cobrancaId ? [l.cobrancaId] : [])].filter((cid) => vinculoPorCobranca.has(cid))}
                  desvincular={(cid) => rodar(() => svc.desvincular(id, cid), 'Vínculo desfeito')} />)}
                {linhas.length === 0 && <tr><td className={td} colSpan={11} style={{ color: 'var(--text-muted)' }}>Nenhuma linha{soDivergencias ? ' divergente' : ''}.</td></tr>}
              </tbody>
            </table>
          </div>
          {conc.fora.length > 0 && (
            <div className="mt-[10px]">
              <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>Cobranças fora do cronograma ({conc.fora.length}) — entrada, acordos, reembolsos e o que não casou com data nenhuma</div>
              <ul className="mt-[4px] flex flex-col gap-[4px]">
                {conc.fora.map((f) => {
                  const chave = `cobranca:${f.cobrancaId}`;
                  const rec = reconhecidas.get(chave);
                  return (
                    <li key={f.cobrancaId} className="flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-body)' }}>
                      <span className="tabular-nums">{dataBR(f.vencimento)}</span>
                      <b className="tabular-nums">{formatCurrency(f.valorOriginal)}</b>
                      <StatusBadge label={f.classe} colors={COBRANCA_LEGADA_COLORS} />
                      <span style={{ color: 'var(--text-secondary)' }}>{cobrancaPorId.get(f.cobrancaId)?.tipoRotulo ?? f.tipo} — {f.motivo}</span>
                      {f.descricao && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>“{f.descricao}”</span>}
                      {/* Vínculo manual (23/09): o operador aponta a cobrança para a linha que ela quita. */}
                      {editavel && !rec && (
                        <select className="rounded-[6px] px-[6px] py-[3px] text-[11px]" style={inputStyle} value="" onChange={(e) => { if (e.target.value) void rodar(() => svc.vincular(id, f.cobrancaId, e.target.value), 'Cobrança vinculada à linha'); }}>
                          <option value="">→ vincular a…</option>
                          {conc.linhas.filter((l) => l.situacao !== 'paga' && l.situacao !== 'paga_com_encargo').map((l) => (
                            <option key={l.chave} value={l.chave}>{l.serie === 'entrada' ? 'Entrada' : l.serie === 'parcela' ? `Parcela ${l.numero}` : `Intermediária ${l.numero}`} · {dataBR(l.esperadoEm)} · {formatCurrency(l.esperadoValor)}</option>
                          ))}
                        </select>
                      )}
                      {f.divergencia && (rec
                        ? <span className="text-[11px]" style={{ color: rec.desfecho ? CASO_LEGADO_STATUS_COLORS.MIGRADO.fg : SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}>reconhecida{rec.desfecho ? ' · cobrança avulsa' : ' · sem desfecho, reconheça de novo'}: {rec.nota}{editavel && <button className="ml-[6px] underline" onClick={() => rodar(() => svc.desfazerReconhecimento(id, chave), '')}>desfazer</button>}</span>
                        : editavel && <span className="flex items-center gap-[4px]"><input className="rounded-[6px] px-[6px] py-[3px] text-[11px]" style={inputStyle} placeholder="por quê?" value={notaDiv[chave] ?? ''} onChange={(e) => setNotaDiv({ ...notaDiv, [chave]: e.target.value })} /><button className="text-[11px] underline" disabled={!(notaDiv[chave] ?? '').trim()} onClick={() => rodar(() => svc.reconhecerDivergencia(id, chave, notaDiv[chave] ?? '', 'COBRANCA_AVULSA'), 'Divergência reconhecida')}>reconhecer como cobrança avulsa</button></span>)}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Cobranças */}
      <div className="rounded-[12px] p-[14px]" style={bloco}>
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div className={tituloBloco} style={{ color: 'var(--text-muted)' }}>Cobranças no Asaas ({c.cobrancas.length}) — leitura da descrição: regra propõe, você confirma</div>
          <div className="flex items-center gap-[10px]">
            <label className="flex items-center gap-[6px] text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={soDuvidas} onChange={(e) => setSoDuvidas(e.target.checked)} /> só em dúvida ({c.cobrancas.filter((p) => p.duvida).length})
            </label>
            {editavel && <button className={btn} style={btnSec} disabled={ocupado} onClick={() => rodar(() => svc.reinterpretar(id), 'Regras reaplicadas')}>Reaplicar regras</button>}
          </div>
        </div>
        <div className="mt-[8px] max-h-[520px] overflow-auto rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full min-w-[1100px] border-collapse">
            <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
              <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                <th className={th}>Venc.</th><th className={`${th} text-right`}>Valor</th><th className={`${th} text-right`}>Encargo</th><th className={th}>Pago em</th><th className={th}>Situação</th>
                <th className={th}>Tipo</th><th className={th}>Decomposição</th><th className={th}>Leitura</th><th className={th}>Descrição</th><th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {cobrancas.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', opacity: p.deletada ? 0.5 : 1, background: p.duvida ? CASO_LEGADO_STATUS_COLORS.EM_REVISAO.bg : undefined }}>
                  <td className={`${td} tabular-nums whitespace-nowrap`}>{dataBR(p.vencimento)}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{formatCurrency(p.valorOriginal)}</td>
                  <td className={`${td} text-right tabular-nums`} style={{ color: p.encargoPago ? SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg : 'var(--text-muted)' }}>{p.encargoPago ? formatCurrency(p.encargoPago) : '—'}</td>
                  <td className={`${td} tabular-nums whitespace-nowrap`}>{dataBR(p.pagoEm)}</td>
                  <td className={td}><StatusBadge label={p.classe} colors={COBRANCA_LEGADA_COLORS} /></td>
                  <td className={td}>
                    {editavel ? (
                      <select className="rounded-[6px] px-[6px] py-[4px] text-[11.5px]" style={inputStyle} value={p.tipoInterpretado ?? ''} onChange={(e) => mudarTipo(p, e.target.value as TipoCobrancaLegada)} disabled={ocupado}>
                        <option value="" disabled>—</option>
                        {c.tiposCobranca.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                      </select>
                    ) : <span>{p.tipoRotulo ?? '—'}</span>}
                  </td>
                  <td className={`${td} tabular-nums`} style={{ color: 'var(--text-secondary)' }}>
                    {p.interpretacao ? <>{formatCurrency(p.interpretacao.parcelamento)}{p.interpretacao.seguro ? ` + seg ${formatCurrency(p.interpretacao.seguro)}` : ''}{p.interpretacao.taxa ? ` + taxa ${formatCurrency(p.interpretacao.taxa)}` : ''}{p.interpretacao.intermediaria ? ` + inter ${formatCurrency(p.interpretacao.intermediaria)}` : ''}{p.interpretacao.extra ? ` + ${p.interpretacao.extraRotulo ?? 'despesa'} ${formatCurrency(p.interpretacao.extra)}` : ''}{p.interpretacao.encargo ? ` + juros/multa ${formatCurrency(p.interpretacao.encargo)}` : ''}</> : '—'}
                  </td>
                  <td className={td}>
                    {p.duvida && <span className="mr-[4px] rounded-full px-[6px] py-[1px] text-[10px] font-bold" style={{ background: CASO_LEGADO_STATUS_COLORS.EM_REVISAO.fg, color: '#fff' }}>dúvida</span>}
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.interpretadoPor === 'operador' ? 'você' : p.interpretadoPor ?? '—'}{p.interpretacao?.motivo ? ` · ${p.interpretacao.motivo}` : ''}</span>
                    {p.interpretacaoObs && <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{p.interpretacaoObs}</div>}
                  </td>
                  <td className={td} style={{ color: 'var(--text-body)' }}>{p.descricao ?? <span style={{ color: 'var(--text-muted)' }}>sem descrição</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {editavel && p.duvida && p.interpretacao && <button className="text-[11px] underline" disabled={ocupado} onClick={() => confirmarProposta(p)}>confirmar</button>}
                    {editavel && <button className="ml-[6px] text-[11px] underline" disabled={ocupado} onClick={() => setAjuste(p)}>ajustar</button>}
                    {editavel && p.interpretadoPor === 'operador' && <button className="ml-[6px] text-[11px] underline" disabled={ocupado} onClick={() => rodar(() => svc.desfazerInterpretacao(id, p.id), '')}>desfazer</button>}
                    {p.invoiceUrl && <a href={p.invoiceUrl} target="_blank" rel="noreferrer" className="ml-[6px] text-[11px] underline" style={{ color: 'var(--accent)' }}>boleto</a>}
                  </td>
                </tr>
              ))}
              {cobrancas.length === 0 && <tr><td className={td} colSpan={10} style={{ color: 'var(--text-muted)' }}>Nenhuma cobrança{soDuvidas ? ' em dúvida' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {ajuste && <AjusteModal p={ajuste} tipos={c.tiposCobranca} parcelaContrato={c.termos?.parcelas.valor ?? null} onClose={() => setAjuste(null)} salvar={(corpo) => rodar(() => svc.definirInterpretacao(id, ajuste.id, corpo), 'Leitura ajustada').then(() => setAjuste(null))} />}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-[10.5px] font-semibold" style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
      {children}
    </label>
  );
}

function LinhaConc({ l, reconhecida, editavel, nota, setNota, desfecho, setDesfecho, desfechos, reconhecer, desfazer, vinculadas, desvincular }: { l: LinhaConciliacao; reconhecida: DivergenciaReconhecida | null; editavel: boolean; nota: string; setNota: (v: string) => void; desfecho: DesfechoDivergencia | ''; setDesfecho: (v: DesfechoDivergencia | '') => void; desfechos: { valor: DesfechoDivergencia; rotulo: string }[]; reconhecer: () => void; desfazer: () => void; vinculadas: string[]; desvincular: (cobrancaId: string) => void }) {
  const cor = CONCILIACAO_LINHA_COLORS[l.situacao];
  const rotuloItem = l.serie === 'entrada' ? 'Entrada' : l.serie === 'parcela' ? `Parcela ${l.numero}` : `Intermediária ${l.numero}`;
  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: l.divergencia && !reconhecida ? CASO_LEGADO_STATUS_COLORS.DESCARTADO.bg : undefined }}>
      <td className={td} title={l.confianca === 'alta' ? 'Casou sem ressalva' : l.confianca === 'media' ? 'Conferir: casou com deslocamento, em partes, por vínculo ou por acordo' : 'Decidir: diverge ou não há cobrança'}>
        <span className="inline-block h-[9px] w-[9px] rounded-full" style={{ background: CONFIANCA_LINHA_COLORS[l.confianca]?.fg }} />
      </td>
      <td className={`${td} font-semibold`}>{rotuloItem}</td>
      <td className={`${td} tabular-nums`}>{dataBR(l.esperadoEm)}</td>
      <td className={`${td} text-right tabular-nums`}>{formatCurrency(l.esperadoValor)}</td>
      <td className={`${td} tabular-nums`}>
        {dataBR(l.cobradoEm)}
        {l.partes.length > 1 && <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{l.partes.length} transações</div>}
        {l.observacao && <div className="text-[10.5px]" style={{ color: CASO_LEGADO_STATUS_COLORS.EM_REVISAO.fg }}>{l.observacao}</div>}
        {editavel && vinculadas.length > 0 && <div className="text-[10.5px]">{vinculadas.map((cid) => <button key={cid} className="mr-[6px] underline" style={{ color: 'var(--text-muted)' }} onClick={() => desvincular(cid)}>desvincular</button>)}</div>}
      </td>
      <td className={`${td} text-right tabular-nums`} style={{ color: l.situacao === 'valor_diverge' ? SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg : undefined }}>
        {l.cobradoValor == null ? '—' : formatCurrency(l.cobradoValor)}
        {/* Entrada em várias transações (23/09): mostra as partes somadas. */}
        {l.partes.length > 1 && <div className="text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>{l.partes.map((x) => `${dataBR(x.vencimento)} ${formatCurrency(x.valor)}`).join(' + ')}</div>}
        {/* Despesa repassada junto da parcela: explica o "cobrado" maior que o esperado. */}
        {l.componentes && (l.componentes.extra > 0 || l.componentes.intermediaria > 0) && (
          <div className="text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>
            {l.componentes.intermediaria > 0 && `+ intermediária ${formatCurrency(l.componentes.intermediaria)} `}
            {l.componentes.extra > 0 && `+ ${l.componentes.extraRotulo ?? 'despesa'} ${formatCurrency(l.componentes.extra)}`}
          </div>
        )}
        {/* Parcela de acordo cobrada junto (§26.14): não é desta parcela — quita outra. */}
        {l.componentes && l.componentes.acordo > 0 && (
          <div className="text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>+ acordo {formatCurrency(l.componentes.acordo)} (quita outra parcela)</div>
        )}
      </td>
      <td className={`${td} tabular-nums`}>{dataBR(l.pagoEm)}</td>
      <td className={`${td} text-right tabular-nums`}>{l.pagoValor == null ? '—' : formatCurrency(l.pagoValor)}</td>
      <td className={`${td} text-right tabular-nums`} style={{ color: l.encargo ? SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg : 'var(--text-muted)' }}>{l.encargo ? formatCurrency(l.encargo) : '—'}</td>
      <td className={td}><span className="inline-flex items-center rounded-[6px] px-[7px] py-[2px] text-[10.5px] font-semibold" style={{ background: cor.bg, color: cor.fg }}>{SITUACAO_LINHA_ROTULO[l.situacao]}</span></td>
      <td className={td}>
        {!l.divergencia ? <span style={{ color: 'var(--text-muted)' }}>—</span> : reconhecida
          ? <span className="text-[11px]" style={{ color: reconhecida.desfecho ? CASO_LEGADO_STATUS_COLORS.MIGRADO.fg : SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}>
              {reconhecida.desfecho ? `${desfechos.find((d) => d.valor === reconhecida.desfecho)?.rotulo ?? reconhecida.desfecho}: ` : 'reconhecida sem desfecho, reconheça de novo: '}{reconhecida.nota}
              {editavel && <button className="ml-[6px] underline" onClick={desfazer}>desfazer</button>}
            </span>
          : editavel
            ? <span className="flex flex-wrap items-center gap-[4px]">
                <select className="rounded-[6px] px-[6px] py-[3px] text-[11px]" style={inputStyle} value={desfecho} onChange={(e) => setDesfecho(e.target.value as DesfechoDivergencia | '')}>
                  <option value="">desfecho na migração…</option>
                  {desfechos.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
                </select>
                <input className="w-[180px] rounded-[6px] px-[6px] py-[3px] text-[11px]" style={inputStyle} placeholder="por quê? (ex.: pago em dinheiro)" value={nota} onChange={(e) => setNota(e.target.value)} />
                <button className="text-[11px] underline" disabled={!nota.trim() || !desfecho} onClick={reconhecer}>reconhecer</button>
              </span>
            : <span className="text-[11px]" style={{ color: SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg }}>sem reconhecimento</span>}
      </td>
    </tr>
  );
}

function AjusteModal({ p, tipos, parcelaContrato, onClose, salvar }: { p: CobrancaLegada; tipos: { valor: TipoCobrancaLegada; rotulo: string }[]; parcelaContrato: number | null; onClose: () => void; salvar: (corpo: { tipo: TipoCobrancaLegada; parcelamento: number; seguro: number; taxa: number; intermediaria: number; extra: number; extraRotulo?: string; encargo: number; observacao?: string }) => void }) {
  const i = p.interpretacao;
  const [tipo, setTipo] = useState<TipoCobrancaLegada>(i?.tipo ?? 'parcela');
  const [seguro, setSeguro] = useState(reaisTxt(i?.seguro ?? 0));
  const [taxa, setTaxa] = useState(reaisTxt(i?.taxa ?? 0));
  const [inter, setInter] = useState(reaisTxt(i?.intermediaria ?? 0));
  const [extra, setExtra] = useState(reaisTxt(i?.extra ?? 0));
  const [extraRotulo, setExtraRotulo] = useState(i?.extraRotulo ?? '');
  const [encargo, setEncargo] = useState(reaisTxt(i?.encargo ?? 0));
  const [obs, setObs] = useState(p.interpretacaoObs ?? '');
  const s = reaisParaCentavos(seguro || '0'); const t = reaisParaCentavos(taxa || '0'); const n = reaisParaCentavos(inter || '0');
  const x = reaisParaCentavos(extra || '0');
  const j = reaisParaCentavos(encargo || '0');
  const parcelamento = p.valorOriginal - s - t - n - x - j;
  return (
    <Modal open onClose={onClose} title={`Ajustar leitura — ${dataBR(p.vencimento)} · ${formatCurrency(p.valorOriginal)}`} largura={520}>
      <div className="flex flex-col gap-[10px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
        <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Descrição no Asaas: {p.descricao ?? '—'}</div>
        <Campo rotulo="Tipo"><select className={inputCls} style={inputStyle} value={tipo} onChange={(e) => setTipo(e.target.value as TipoCobrancaLegada)}>{tipos.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}</select></Campo>
        <div className="grid grid-cols-3 gap-[8px]">
          <Campo rotulo="Seguro"><input className={inputCls} style={inputStyle} value={seguro} onChange={(e) => setSeguro(e.target.value)} /></Campo>
          <Campo rotulo="Taxa"><input className={inputCls} style={inputStyle} value={taxa} onChange={(e) => setTaxa(e.target.value)} /></Campo>
          <Campo rotulo="Intermediária junto"><input className={inputCls} style={inputStyle} value={inter} onChange={(e) => setInter(e.target.value)} /></Campo>
        </div>
        {/* Despesa repassada junto da parcela (23/09): manutenção, IPVA… na mesma cobrança. */}
        <div className="grid grid-cols-[1fr_2fr] gap-[8px]">
          <Campo rotulo="Despesa junto (R$)"><input className={inputCls} style={inputStyle} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0,00" /></Campo>
          <Campo rotulo="Qual despesa"><input className={inputCls} style={inputStyle} value={extraRotulo} onChange={(e) => setExtraRotulo(e.target.value)} placeholder="ex.: Manutenção periódica" /></Campo>
        </div>
        <Campo rotulo="Juros/multa embutidos (R$) — parcela reemitida por atraso"><input className={inputCls} style={inputStyle} value={encargo} onChange={(e) => setEncargo(e.target.value)} placeholder="0,00" /></Campo>
        <div>Parcelamento (o resto): <b className="tabular-nums" style={{ color: parcelamento < 0 ? SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg : 'var(--text-primary)' }}>{formatCurrency(parcelamento)}</b>
          {/* Caso real 23/09: o operador punha o resto em "juros" e a parcela ficava 940 em vez de 942. */}
          {tipo === 'parcela' && parcelaContrato != null && parcelamento !== parcelaContrato && parcelamento - parcelaContrato + j >= 0 && (
            <button className="ml-[8px] text-[11px] underline" style={{ color: 'var(--accent)' }}
              onClick={() => setEncargo(reaisTxt(parcelamento - parcelaContrato + j))}>
              fechar com a parcela do contrato ({formatCurrency(parcelaContrato)}) e jogar a diferença em juros
            </button>
          )}
        </div>
        <Campo rotulo="Observação"><input className={inputCls} style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: seguro veio a mais nesta semana" /></Campo>
        <div className="flex justify-end gap-[8px]">
          <button className={btn} style={btnSec} onClick={onClose}>Cancelar</button>
          <button className={btn} style={btnPri} disabled={parcelamento < 0} onClick={() => salvar({ tipo, parcelamento, seguro: s, taxa: t, intermediaria: n, extra: x, extraRotulo: extraRotulo || undefined, encargo: j, observacao: obs })}>Salvar leitura</button>
        </div>
      </div>
    </Modal>
  );
}
