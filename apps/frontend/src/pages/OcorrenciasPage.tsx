import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { frotaService as svc, type Ocorrencia, type ResumoImportacao } from '../services/frota.service';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole, ROLE_OPERACAO } from '../lib/permissoes';
import { OCORRENCIA_STATUS_COLORS, RESPONSAVEL_OCORRENCIA_COLORS } from '../config/statusColors';

// Multas e pendências (doc 02 §25.2/§25.3). É um KANBAN porque cada desfecho é
// TRATATIVA MANUAL (decisão Luís 20/09) — ao contrário da frota, que é lista,
// já que o status do veículo muda sozinho com o contrato.

// Data-calendário direto do ISO (mesma convenção das outras telas): converter
// pelo fuso local faz 01/09 virar 31/08, porque o vencimento é UTC-meia-noite.
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const btn = 'h-[30px] rounded-[8px] px-[10px] text-[11.5px] font-semibold disabled:opacity-50';
const btnSec = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' } as const;
const inputCls = 'w-full rounded-[8px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

// Etapas do quadro: as três primeiras são o que espera decisão; a última fecha o ciclo.
const COLUNAS: { chave: string; titulo: string; ajuda: string; status: string[] }[] = [
  { chave: 'novas', titulo: 'Novas', ajuda: 'Chegaram e ainda não têm desfecho', status: ['REGISTRADA'] },
  { chave: 'recurso', titulo: 'Em recurso', ajuda: 'Aguardando decisão do órgão', status: ['EM_RECURSO'] },
  { chave: 'comprovante', titulo: 'Aguardando comprovante', ajuda: 'Cliente ficou de pagar direto', status: ['AGUARDANDO_COMPROVANTE'] },
  { chave: 'encerradas', titulo: 'Encerradas', ajuda: 'Cobradas, quitadas, assumidas ou canceladas', status: ['REPASSADA', 'QUITADA', 'ASSUMIDA_AZIT', 'CANCELADA'] },
];

type Acao = 'repassar' | 'cliente-paga' | 'assumir' | 'recurso' | 'cancelar' | 'responsavel' | 'comprovante';

function Card({ o, onAbrir }: { o: Ocorrencia; onAbrir: () => void }) {
  const cor = OCORRENCIA_STATUS_COLORS[o.status];
  const corResp = RESPONSAVEL_OCORRENCIA_COLORS[o.responsavel];
  const prazoVencido = o.status === 'AGUARDANDO_COMPROVANTE' && !!o.prazoComprovante && new Date(o.prazoComprovante) < new Date();
  return (
    <div onClick={onAbrir} role="button" title="Abrir a ocorrência"
      className="cursor-pointer rounded-[10px] p-[11px] transition-shadow hover:shadow-[0_4px_14px_rgba(0,16,41,.12)]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>{o.ativo.placa ?? 'sem placa'}</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{o.tipoRotulo}{o.numeroAuto ? ` · ${o.numeroAuto}` : ''}</div>
        </div>
        <span className="whitespace-nowrap rounded-full px-[8px] py-[1px] text-[10px] font-bold" style={{ background: corResp.bg, color: corResp.fg }}>
          {o.responsavel === 'CLIENTE' ? 'cliente' : 'Azit'}
        </span>
      </div>
      {o.contrato && (
        <div className="mt-[4px] truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.contrato.titular.nome}</div>
      )}
      <div className="mt-[7px] flex items-center justify-between">
        <span className="font-display text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(o.valorComDesconto ?? o.valor)}</span>
        <span className="text-[10.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>fato {dataBR(o.dataFato)}</span>
      </div>
      {o.status === 'AGUARDANDO_COMPROVANTE' && o.prazoComprovante && (
        <div className="mt-[5px] text-[10.5px] tabular-nums" style={{ color: prazoVencido ? OCORRENCIA_STATUS_COLORS.CANCELADA.fg : 'var(--text-muted)' }}>
          comprovante até {dataBR(o.prazoComprovante)}{prazoVencido ? ' · atrasado' : ''}
        </div>
      )}
      {o.repasse && (
        <div className="mt-[5px] text-[10.5px]" style={{ color: 'var(--text-muted)' }}>fatura {o.repasse.faturaNumero} · venc. {dataBR(o.repasse.vencimento)}</div>
      )}
      {['REPASSADA', 'QUITADA', 'ASSUMIDA_AZIT', 'CANCELADA'].includes(o.status) && (
        <span className="mt-[6px] inline-block rounded-full px-[8px] py-[1px] text-[10px] font-bold" style={{ background: cor.bg, color: cor.fg }}>{o.statusRotulo}</span>
      )}
    </div>
  );
}

export function OcorrenciasPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const [params] = useSearchParams();
  const ativoId = params.get('ativo') ?? undefined;
  const [filtros, setFiltros] = useState({ tipo: '', responsavel: '', busca: '' });
  const lista = useQuery({
    queryKey: ['ocorrencias', filtros, ativoId],
    queryFn: () => svc.ocorrencias({ ativoId, tipo: filtros.tipo || undefined, responsavel: filtros.responsavel || undefined, busca: filtros.busca || undefined }),
  });
  const opcoes = useQuery({ queryKey: ['frota-opcoes'], queryFn: () => svc.opcoes() });

  const [detalhe, setDetalhe] = useState<Ocorrencia | null>(null);
  const [acao, setAcao] = useState<{ tipo: Acao; o: Ocorrencia } | null>(null);
  const [nova, setNova] = useState(false);
  const [importar, setImportar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [campo, setCampo] = useState({ valor: '', prazo: '', obs: '', motivo: '', justificativa: '', responsavel: 'CLIENTE' as 'CLIENTE' | 'AZIT', arquivoNome: '', arquivoConteudo: '' });
  const [formNova, setFormNova] = useState({ placa: '', tipo: 'MULTA', orgao: '', numeroAuto: '', descricao: '', dataFato: '', dataVencimento: '', prazoIndicacao: '', valor: '' });
  const [credencial, setCredencial] = useState({ usuario: '', senha: '' });
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);

  const itens = lista.data ?? [];

  function abrirAcao(tipo: Acao, o: Ocorrencia) {
    setCampo({
      valor: String(((o.valorComDesconto ?? o.valor) / 100).toFixed(2)),
      prazo: '', obs: '', motivo: '', justificativa: '',
      responsavel: o.responsavel === 'CLIENTE' ? 'AZIT' : 'CLIENTE',
      arquivoNome: '', arquivoConteudo: '',
    });
    setDetalhe(null);
    setAcao({ tipo, o });
  }

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      toast.sucesso(ok);
      setAcao(null);
      setNova(false);
      await qc.invalidateQueries({ queryKey: ['ocorrencias'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function executarImportacao() {
    setOcupado(true);
    setResumo(null);
    try {
      const r = await svc.importarInfleet(credencial.usuario, credencial.senha);
      setCredencial({ usuario: '', senha: '' }); // não fica nem na tela
      setResumo(r);
      toast.sucesso(`${r.criadas} nova(s), ${r.atualizadas} atualizada(s).`);
      await qc.invalidateQueries({ queryKey: ['ocorrencias'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function lerArquivo(file: File) {
    const leitor = new FileReader();
    leitor.onload = () => setCampo((c) => ({ ...c, arquivoNome: file.name, arquivoConteudo: String(leitor.result ?? '') }));
    leitor.readAsDataURL(file);
  }

  const aberta = (o: Ocorrencia) => ['REGISTRADA', 'EM_RECURSO', 'AGUARDANDO_COMPROVANTE'].includes(o.status);

  return (
    <div className="flex h-full flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="max-w-[680px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Cada cartão espera uma decisão sua: cobrar do cliente, deixar que ele pague direto ou a Azit assumir. O
          responsável vem da <b>data do fato</b> (cláusulas 6.4 e 6.7 do contrato).
        </p>
        <div className="flex flex-wrap gap-[8px]">
          <Link to="/ativos" className={btn} style={{ ...btnSec, lineHeight: '30px' }}>Frota e estoque</Link>
          {podeOperar && <button className={btn} style={btnSec} onClick={() => { setResumo(null); setImportar(true); }}>Importar do Infleet</button>}
          {podeOperar && <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} onClick={() => setNova(true)}>Nova ocorrência</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-[8px]">
        <select className="h-[32px] rounded-[8px] px-[8px] text-[12px]" style={inputStyle} value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
          <option value="">Todos os tipos</option>
          {(opcoes.data?.tipos ?? []).map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
        </select>
        <select className="h-[32px] rounded-[8px] px-[8px] text-[12px]" style={inputStyle} value={filtros.responsavel} onChange={(e) => setFiltros({ ...filtros, responsavel: e.target.value })}>
          <option value="">Cliente e Azit</option>
          <option value="CLIENTE">Do cliente</option>
          <option value="AZIT">Da Azit</option>
        </select>
        <input className="h-[32px] rounded-[8px] px-[10px] text-[12px]" style={inputStyle} placeholder="Placa ou número do auto"
          value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
      </div>

      <div className="flex flex-1 gap-[13px] overflow-x-auto pb-[8px]">
        {COLUNAS.map((col) => {
          const cards = itens.filter((o) => col.status.includes(o.status));
          const cor = OCORRENCIA_STATUS_COLORS[col.status[0]];
          const total = cards.reduce((s, o) => s + (o.valorComDesconto ?? o.valor), 0);
          return (
            <div key={col.chave} className="flex w-[230px] flex-none flex-col rounded-card" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-[8px] px-[13px] py-[11px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="mt-[4px] h-[9px] w-[9px] flex-none rounded-full" style={{ background: cor.fg }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>{col.titulo}</div>
                  <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }} title={col.ajuda}>{col.ajuda}</div>
                  {total > 0 && <div className="text-[10.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatCurrency(total)}</div>}
                </div>
                <div className="font-display text-[14px] font-bold" style={{ color: cor.fg }}>{cards.length}</div>
              </div>
              <div className="flex flex-1 flex-col gap-[9px] overflow-auto p-[11px]">
                {cards.length === 0 && <div className="py-[10px] text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>Vazio</div>}
                {cards.map((o) => <Card key={o.id} o={o} onAbrir={() => setDetalhe(o)} />)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detalhe + tratativas */}
      {detalhe && (
        <Modal open onClose={() => setDetalhe(null)} title={`${detalhe.tipoRotulo} — ${detalhe.ativo.placa ?? 'sem placa'}`} largura={540}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <div className="flex flex-wrap gap-[6px]">
              <span className="rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: OCORRENCIA_STATUS_COLORS[detalhe.status].bg, color: OCORRENCIA_STATUS_COLORS[detalhe.status].fg }}>{detalhe.statusRotulo}</span>
              <span className="rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: RESPONSAVEL_OCORRENCIA_COLORS[detalhe.responsavel].bg, color: RESPONSAVEL_OCORRENCIA_COLORS[detalhe.responsavel].fg }}>
                {detalhe.responsavel === 'CLIENTE' ? 'Responsável: cliente' : 'Responsável: Azit'}
              </span>
              {detalhe.origem !== 'manual' && <span className="rounded-full px-[9px] py-[2px] text-[11px]" style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>origem: {detalhe.origem}</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-[16px] gap-y-[4px]" style={{ color: 'var(--text-body)' }}>
              <span>Veículo: <b>{detalhe.ativo.descricao}</b></span>
              <span>Valor: <b className="tabular-nums">{formatCurrency(detalhe.valorComDesconto ?? detalhe.valor)}</b></span>
              <span>Data do fato: <b className="tabular-nums">{dataBR(detalhe.dataFato)}</b></span>
              <span>Vencimento: <b className="tabular-nums">{dataBR(detalhe.dataVencimento)}</b></span>
              {detalhe.numeroAuto && <span>Auto: <b>{detalhe.numeroAuto}</b></span>}
              {detalhe.orgao && <span>Órgão: <b>{detalhe.orgao}</b></span>}
              {detalhe.prazoIndicacao && <span>Indicação até: <b className="tabular-nums">{dataBR(detalhe.prazoIndicacao)}</b></span>}
              {detalhe.contrato && (
                <span>Cliente: <Link to={`/contratos/${detalhe.contrato.id}`} className="font-bold hover:underline" style={{ color: 'var(--navy)' }}>{detalhe.contrato.titular.nome}</Link></span>
              )}
            </div>
            {detalhe.descricao && <div style={{ color: 'var(--text-muted)' }}>{detalhe.descricao}</div>}
            {detalhe.responsavelJustificativa && <div style={{ color: 'var(--text-muted)' }}>Responsável alterado: {detalhe.responsavelJustificativa}</div>}
            {detalhe.desfechoObs && <div style={{ color: 'var(--text-muted)' }}>Desfecho: {detalhe.desfechoObs}</div>}
            {detalhe.repasse && <div style={{ color: 'var(--text-muted)' }}>Cobrado na fatura {detalhe.repasse.faturaNumero}, com vencimento em {dataBR(detalhe.repasse.vencimento)}.</div>}

            <div className="flex flex-wrap justify-end gap-[8px] pt-[4px]">
              {detalhe.temComprovante && <button className={btn} style={btnSec} onClick={() => svc.abrirComprovante(detalhe.id)}>Ver comprovante</button>}
              {podeOperar && aberta(detalhe) && (
                <>
                  {detalhe.responsavel === 'CLIENTE' && <button className={btn} style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => abrirAcao('repassar', detalhe)}>Cobrar na fatura</button>}
                  {detalhe.responsavel === 'CLIENTE' && detalhe.status !== 'AGUARDANDO_COMPROVANTE' && <button className={btn} style={btnSec} onClick={() => abrirAcao('cliente-paga', detalhe)}>Cliente paga direto</button>}
                  {detalhe.status === 'AGUARDANDO_COMPROVANTE' && <button className={btn} style={btnSec} onClick={() => abrirAcao('comprovante', detalhe)}>Registrar comprovante</button>}
                  <button className={btn} style={btnSec} onClick={() => abrirAcao('assumir', detalhe)}>Azit assume</button>
                  <button className={btn} style={btnSec} onClick={() => abrirAcao('recurso', detalhe)}>Recurso</button>
                  <button className={btn} style={btnSec} onClick={() => abrirAcao('responsavel', detalhe)}>Trocar responsável</button>
                  <button className={btn} style={btnSec} onClick={() => abrirAcao('cancelar', detalhe)}>Cancelar</button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {acao?.tipo === 'repassar' && (
        <Modal open onClose={() => setAcao(null)} title="Cobrar na fatura do cliente">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>
              O valor entra como item na <b>próxima fatura aberta</b> da conta, junto com as parcelas (cláusula 3.5).
              Se não for paga, segue para a régua de cobrança como qualquer fatura.
            </p>
            <label className="flex flex-col gap-[4px]">Valor a cobrar (R$)
              <input className={inputCls} style={inputStyle} value={campo.valor} onChange={(e) => setCampo({ ...campo, valor: e.target.value })} />
            </label>
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setAcao(null)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--accent)', color: '#fff' }} disabled={ocupado}
                onClick={() => void rodar(async () => {
                  const r = await svc.repassar(acao.o.id, Math.round(Number(campo.valor.replace(',', '.')) * 100));
                  toast.sucesso(`Cobrado na fatura ${r.faturaNumero}.`);
                }, 'Repasse registrado.')}>
                Cobrar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {acao?.tipo === 'cliente-paga' && (
        <Modal open onClose={() => setAcao(null)} title="Cliente paga direto ao órgão">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>Nada vai para a fatura. Fica pendente até o comprovante chegar.</p>
            <label className="flex flex-col gap-[4px]">Prazo para o comprovante
              <input type="date" className={inputCls} style={inputStyle} value={campo.prazo} onChange={(e) => setCampo({ ...campo, prazo: e.target.value })} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Em branco = 7 dias.</span>
            </label>
            <label className="flex flex-col gap-[4px]">Observação
              <input className={inputCls} style={inputStyle} value={campo.obs} onChange={(e) => setCampo({ ...campo, obs: e.target.value })} placeholder="Ex.: combinado por telefone" />
            </label>
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setAcao(null)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado}
                onClick={() => void rodar(() => svc.clientePaga(acao.o.id, { prazoComprovante: campo.prazo ? new Date(campo.prazo).toISOString() : undefined, observacao: campo.obs || undefined }), 'Registrado.')}>
                Confirmar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {acao?.tipo === 'comprovante' && (
        <Modal open onClose={() => setAcao(null)} title="Registrar comprovante do cliente">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <input type="file" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); }} />
            {campo.arquivoNome && <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{campo.arquivoNome}</span>}
            <label className="flex flex-col gap-[4px]">Observação
              <input className={inputCls} style={inputStyle} value={campo.obs} onChange={(e) => setCampo({ ...campo, obs: e.target.value })} />
            </label>
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setAcao(null)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado}
                onClick={() => void rodar(() => svc.comprovante(acao.o.id, {
                  arquivo: campo.arquivoConteudo ? { nome: campo.arquivoNome, conteudo: campo.arquivoConteudo } : undefined,
                  observacao: campo.obs || undefined,
                }), 'Ocorrência quitada.')}>
                Registrar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {acao && ['assumir', 'recurso', 'cancelar', 'responsavel'].includes(acao.tipo) && (
        <Modal open onClose={() => setAcao(null)} title={{
          assumir: 'Azit assume a ocorrência', recurso: 'Marcar em recurso', cancelar: 'Cancelar ocorrência', responsavel: 'Trocar o responsável',
        }[acao.tipo as 'assumir']}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            {acao.tipo === 'assumir' && <p style={{ color: 'var(--text-muted)' }}>O valor vira <b>custo do veículo</b> no centro de custo e não é cobrado do cliente.</p>}
            {acao.tipo === 'responsavel' && (
              <>
                <p style={{ color: 'var(--text-muted)' }}>
                  O sistema definiu <b>{acao.o.responsavel === 'CLIENTE' ? 'Cliente' : 'Azit'}</b> pela data do fato ({dataBR(acao.o.dataFato)}). Para mudar, explique o motivo.
                </p>
                <select className={inputCls} style={inputStyle} value={campo.responsavel} onChange={(e) => setCampo({ ...campo, responsavel: e.target.value as 'CLIENTE' | 'AZIT' })}>
                  <option value="CLIENTE">Cliente</option>
                  <option value="AZIT">Azit</option>
                </select>
                <textarea rows={2} className={inputCls} style={inputStyle} value={campo.justificativa} onChange={(e) => setCampo({ ...campo, justificativa: e.target.value })} placeholder="Justificativa (mínimo 10 caracteres)" />
              </>
            )}
            {acao.tipo === 'recurso' && (
              <label className="flex flex-col gap-[4px]">Prazo do recurso
                <input type="date" className={inputCls} style={inputStyle} value={campo.prazo} onChange={(e) => setCampo({ ...campo, prazo: e.target.value })} />
              </label>
            )}
            {acao.tipo !== 'responsavel' && (
              <label className="flex flex-col gap-[4px]">{acao.tipo === 'cancelar' ? 'Motivo' : 'Observação'}
                <input className={inputCls} style={inputStyle} value={acao.tipo === 'cancelar' ? campo.motivo : campo.obs}
                  onChange={(e) => setCampo(acao.tipo === 'cancelar' ? { ...campo, motivo: e.target.value } : { ...campo, obs: e.target.value })} />
              </label>
            )}
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setAcao(null)}>Fechar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado}
                onClick={() => void rodar(() => {
                  if (acao.tipo === 'assumir') return svc.assumir(acao.o.id, campo.obs || undefined);
                  if (acao.tipo === 'recurso') return svc.recurso(acao.o.id, { prazo: campo.prazo ? new Date(campo.prazo).toISOString() : undefined, observacao: campo.obs || undefined });
                  if (acao.tipo === 'cancelar') return svc.cancelar(acao.o.id, campo.motivo);
                  return svc.definirResponsavel(acao.o.id, campo.responsavel, campo.justificativa);
                }, 'Feito.')}>
                Confirmar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {nova && (
        <Modal open onClose={() => setNova(false)} title="Nova ocorrência" largura={560}>
          <div className="grid grid-cols-1 gap-[10px] text-[12.5px] sm:grid-cols-2">
            <label className="flex flex-col gap-[4px]">Placa *
              <input className={inputCls} style={inputStyle} value={formNova.placa} onChange={(e) => setFormNova({ ...formNova, placa: e.target.value.toUpperCase() })} />
            </label>
            <label className="flex flex-col gap-[4px]">Tipo *
              <select className={inputCls} style={inputStyle} value={formNova.tipo} onChange={(e) => setFormNova({ ...formNova, tipo: e.target.value })}>
                {(opcoes.data?.tipos ?? []).map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-[4px]">Data do fato *
              <input type="date" className={inputCls} style={inputStyle} value={formNova.dataFato} onChange={(e) => setFormNova({ ...formNova, dataFato: e.target.value })} />
            </label>
            <label className="flex flex-col gap-[4px]">Valor (R$)
              <input className={inputCls} style={inputStyle} value={formNova.valor} onChange={(e) => setFormNova({ ...formNova, valor: e.target.value })} />
            </label>
            <label className="flex flex-col gap-[4px]">Número do auto
              <input className={inputCls} style={inputStyle} value={formNova.numeroAuto} onChange={(e) => setFormNova({ ...formNova, numeroAuto: e.target.value })} />
            </label>
            <label className="flex flex-col gap-[4px]">Órgão
              <input className={inputCls} style={inputStyle} value={formNova.orgao} onChange={(e) => setFormNova({ ...formNova, orgao: e.target.value })} placeholder="Detran-ES, PRF…" />
            </label>
            <label className="flex flex-col gap-[4px]">Vencimento
              <input type="date" className={inputCls} style={inputStyle} value={formNova.dataVencimento} onChange={(e) => setFormNova({ ...formNova, dataVencimento: e.target.value })} />
            </label>
            <label className="flex flex-col gap-[4px]">Prazo de indicação
              <input type="date" className={inputCls} style={inputStyle} value={formNova.prazoIndicacao} onChange={(e) => setFormNova({ ...formNova, prazoIndicacao: e.target.value })} />
            </label>
            <label className="flex flex-col gap-[4px] sm:col-span-2">Descrição
              <input className={inputCls} style={inputStyle} value={formNova.descricao} onChange={(e) => setFormNova({ ...formNova, descricao: e.target.value })} placeholder="Ex.: excesso de velocidade até 20%" />
            </label>
            <div className="flex justify-end gap-[8px] sm:col-span-2">
              <button className={btn} style={btnSec} onClick={() => setNova(false)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado || !formNova.placa || !formNova.dataFato}
                onClick={() => void rodar(() => svc.registrar({
                  placa: formNova.placa,
                  tipo: formNova.tipo,
                  orgao: formNova.orgao || undefined,
                  numeroAuto: formNova.numeroAuto || undefined,
                  descricao: formNova.descricao || undefined,
                  dataFato: new Date(formNova.dataFato).toISOString(),
                  dataVencimento: formNova.dataVencimento ? new Date(formNova.dataVencimento).toISOString() : undefined,
                  prazoIndicacao: formNova.prazoIndicacao ? new Date(formNova.prazoIndicacao).toISOString() : undefined,
                  valor: formNova.valor ? Math.round(Number(formNova.valor.replace(',', '.')) * 100) : 0,
                }), 'Ocorrência registrada.')}>
                Registrar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {importar && (
        <Modal open onClose={() => { setImportar(false); setCredencial({ usuario: '', senha: '' }); }} title="Importar multas do Infleet" largura={560}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>
              O Infleet não fornece credencial de integração, então o sistema entra lá como você, num navegador no
              servidor, e lê o quadro de infrações. <b>Sua senha não é guardada</b>: ela existe só durante esta
              importação — não vai para banco, log nem fila.
            </p>
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              <label className="flex flex-col gap-[4px]">Usuário do Infleet
                <input className={inputCls} style={inputStyle} autoComplete="off" value={credencial.usuario} onChange={(e) => setCredencial({ ...credencial, usuario: e.target.value })} />
              </label>
              <label className="flex flex-col gap-[4px]">Senha
                <input type="password" className={inputCls} style={inputStyle} autoComplete="new-password" value={credencial.senha} onChange={(e) => setCredencial({ ...credencial, senha: e.target.value })} />
              </label>
            </div>
            <div className="flex items-center justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => { setImportar(false); setCredencial({ usuario: '', senha: '' }); }}>Fechar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado || !credencial.usuario || !credencial.senha}
                onClick={() => void executarImportacao()}>
                {ocupado ? 'Importando… (pode levar 1 min)' : 'Importar agora'}
              </button>
            </div>

            {resumo && (
              <div className="flex flex-col gap-[6px] rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
                <div><b>{resumo.lidas}</b> registro(s) lido(s) · <b>{resumo.criadas}</b> nova(s) · <b>{resumo.atualizadas}</b> atualizada(s)</div>
                {resumo.ignoradas.length > 0 && (
                  <div>
                    <div className="font-semibold">Ignoradas ({resumo.ignoradas.length}):</div>
                    {resumo.ignoradas.slice(0, 8).map((i, n) => (
                      <div key={n} className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{i.placa ?? '?'} {i.numeroAuto ?? ''} — {i.motivo}</div>
                    ))}
                  </div>
                )}
                {resumo.naoMapeadas > 0 && (
                  <div className="text-[11.5px]" style={{ color: OCORRENCIA_STATUS_COLORS.CANCELADA.fg }}>
                    {resumo.naoMapeadas} registro(s) vieram num formato que ainda não sei ler. Mande este trecho para o
                    time de desenvolvimento:
                    <pre className="mt-[4px] max-h-[160px] overflow-auto whitespace-pre-wrap rounded-[8px] p-[8px] text-[10.5px]" style={{ background: 'var(--surface)' }}>
                      {JSON.stringify(resumo.amostraBruta, null, 1)?.slice(0, 1200)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
