import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, RAIAS_REGUA, resolverRaiaRegua, type RaiaRegua } from '@azit/utils';
import { reguaService, type ReguaItem } from '../services/regua.service';
import { operacoesService } from '../services/operacoes.service';
import { Modal } from '../components/Modal';
import { ModalConfirmacao } from '../components/ModalConfirmacao';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { Botao } from '../components/Botao';
import { CartaoIndicador, type TomIndicador } from '../components/CartaoIndicador';
import { REGUA_STAGE_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { dataBR } from '../lib/datas';

// Kanban por RAIAS de atraso (decisão Luís 31/10, doc 02 §7.6): "Vence hoje",
// vencida até 7 / 14 / 21 / 30 / 60 dias e mais de 60 — a coluna por dia (1…7,
// +7, de 31/08) poluía e não mostrava o que importa. As raias vêm de
// `RAIAS_REGUA` (@azit/utils, Regra 16): o caso se MOVE de raia conforme o
// atraso da parcela vencida mais antiga; "Vence hoje" entra antes de atrasar.
// Os marcos da régua (cobrança D+1/D+2, extrajudicial, recuperação) são o
// subtítulo da raia; a cor vem do estágio correspondente (statusColors, Regra 9).
// Bloqueio do veículo disponível a partir da raia "até 14 dias" (backend decide:
// `bloqueioDisponivel` no item). Cartões no topo = contadores por raia que
// filtram o quadro; busca por nome/CPF/placa/contrato filtra junto.
// Caso só em intervenção (bloqueado/recuperação, sem atraso) fica na raia extra
// "Em intervenção", visível só quando existe.
// Raia SELECIONADA (01/11, Luís: "as caixinhas são muito pequenas"): em vez da
// coluna de 190px com o resto da tela vazio, a raia toma a largura inteira e os
// cartões viram uma grade larga (CardLargo) — nome legível, placa/modelo/contrato
// numa linha, valor grande, atraso por extenso, ações lado a lado.
type ChaveColuna = RaiaRegua['chave'] | 'intervencao';
const RAIA_INTERVENCAO = { chave: 'intervencao' as const, rotulo: 'Em intervenção', marco: 'bloqueado ou em recuperação, sem atraso', estagio: 'D+3' as const };
const COLUNAS: { chave: ChaveColuna; rotulo: string; marco: string; estagio: RaiaRegua['estagio'] }[] = [
  ...RAIAS_REGUA.map((r) => ({ chave: r.chave, rotulo: r.rotulo, marco: r.marco, estagio: r.estagio })),
  RAIA_INTERVENCAO,
];
function colunaDoItem(i: ReguaItem): ChaveColuna | null {
  const raia = resolverRaiaRegua(i.diasAtraso, i.parcelasVenceHoje > 0);
  if (raia) return raia.chave;
  return i.bloqueado || i.emRecuperacao ? 'intervencao' : null;
}
const TOM_COLUNA: Record<ChaveColuna, TomIndicador> = {
  hoje: 'neutro', ate7: 'warn', ate14: 'bad', ate21: 'bad', ate30: 'bad', ate60: 'bad', mais60: 'neutro', intervencao: 'neutro',
};
function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function casaBusca(i: ReguaItem, termo: string): boolean {
  if (!termo) return true;
  const alvo = normalizar([i.titular.nome, i.titular.cpfCnpj, i.numero, i.ativo?.placa ?? '', i.ativo?.modelo ?? ''].join(' '));
  const digitos = termo.replace(/\D/g, '');
  return normalizar(termo).split(/\s+/).filter(Boolean).every((t) => alvo.includes(t)) || (digitos.length >= 3 && i.titular.cpfCnpj.replace(/\D/g, '').includes(digitos));
}

type AcaoRegua = 'bloquear' | 'desbloquear' | 'recuperar' | 'encerrar_recuperacao';

function Card({ item, onAcao, onAbrir, ocupado, podeOperar }: { item: ReguaItem; onAcao: (acao: AcaoRegua, item: ReguaItem) => void; onAbrir: () => void; ocupado: boolean; podeOperar: boolean }) {
  // Bloqueio disponível a partir da raia "até 14 dias" — quem decide é o backend (31/10).
  const podeBloquear = podeOperar && !item.bloqueado && item.bloqueioDisponivel;
  // Recuperação do veículo a partir da raia "até 30 dias" (doc 02 §29.1, 04/11).
  const podeRecuperar = podeOperar && !item.emRecuperacao && item.recuperacaoDisponivel;
  const soHoje = item.diasAtraso === 0 && item.parcelasVenceHoje > 0;
  return (
    <div
      onClick={onAbrir}
      role="button"
      title="Abrir o caso de cobrança"
      className="cursor-pointer rounded-[10px] p-[12px] transition-[filter] hover:brightness-[1.03]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {item.titular.nome}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {item.ativo?.placa ?? '—'}
          </div>
          <div className="mb-[9px] text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {item.ativo?.modelo ?? '—'} · {item.numero}
          </div>
        </div>
        {(item.bloqueado || item.emRecuperacao) && (
          <span
            className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold"
            style={item.bloqueado ? { background: 'var(--danger-bg)', color: 'var(--danger-fg)' } : { background: 'var(--purple-bg)', color: 'var(--purple-fg)' }}
          >
            {item.bloqueado ? 'Bloqueado' : 'Em recuperação'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="font-display text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {formatCurrency(soHoje ? item.valorVenceHoje : item.valorVencido)}
        </div>
        <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
          {soHoje ? `vence hoje · ${item.faturasVenceHoje}f` : `${item.diasAtraso}d · ${item.faturasVencidas}f`}
          {!soHoje && item.faturasVenceHoje > 0 ? ` · +${item.faturasVenceHoje} hoje` : ''}
        </div>
      </div>
      {(podeBloquear || (item.bloqueado && podeOperar)) && (
        <Botao
          variante={item.bloqueado ? 'secundaria' : 'perigo'}
          tamanho="sm"
          className="mt-[10px] w-full"
          onClick={(e) => { e.stopPropagation(); onAcao(item.bloqueado ? 'desbloquear' : 'bloquear', item); }}
          disabled={ocupado}
        >
          {item.bloqueado ? 'Desbloquear' : 'Bloquear veículo'}
        </Botao>
      )}
      {(podeRecuperar || (item.emRecuperacao && podeOperar)) && (
        <Botao
          variante="secundaria"
          tamanho="sm"
          className="mt-[6px] w-full"
          onClick={(e) => { e.stopPropagation(); onAcao(item.emRecuperacao ? 'encerrar_recuperacao' : 'recuperar', item); }}
          disabled={ocupado}
        >
          {item.emRecuperacao ? 'Encerrar recuperação' : 'Iniciar recuperação'}
        </Botao>
      )}
    </div>
  );
}

// Cartão da raia expandida: mesma informação do Card, com espaço para ler.
function CardLargo({ item, proximaAcao, onAcao, onAbrir, ocupado, podeOperar }: { item: ReguaItem; proximaAcao: string; onAcao: (acao: AcaoRegua, item: ReguaItem) => void; onAbrir: () => void; ocupado: boolean; podeOperar: boolean }) {
  const podeBloquear = podeOperar && !item.bloqueado && item.bloqueioDisponivel;
  const podeRecuperar = podeOperar && !item.emRecuperacao && item.recuperacaoDisponivel;
  const soHoje = item.diasAtraso === 0 && item.parcelasVenceHoje > 0;
  const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);
  const atraso = soHoje
    ? `vence hoje · ${item.faturasVenceHoje} ${plural(item.faturasVenceHoje, 'fatura', 'faturas')}`
    : item.diasAtraso > 0
      ? `${item.diasAtraso} ${plural(item.diasAtraso, 'dia', 'dias')} de atraso · ${item.faturasVencidas} ${plural(item.faturasVencidas, 'fatura vencida', 'faturas vencidas')}${item.faturasVenceHoje > 0 ? ` · mais ${item.faturasVenceHoje} vence hoje` : ''}`
      : 'sem fatura vencida';
  const situacao = item.bloqueado ? 'Veículo bloqueado' : item.emRecuperacao ? 'Em recuperação' : null;
  return (
    <div
      onClick={onAbrir}
      role="button"
      title="Abrir o caso de cobrança"
      className="grid cursor-pointer grid-cols-[1fr_auto] gap-x-[12px] gap-y-[8px] rounded-[12px] px-[16px] py-[14px] transition-[filter] hover:brightness-[1.03]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="min-w-0">
        <div className="truncate text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{item.titular.nome}</div>
        <div className="truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{item.ativo?.placa ?? 'sem placa'}</strong> · {item.ativo?.modelo ?? 'sem ativo'} · contrato {item.numero}
        </div>
      </div>
      <span
        className="self-start justify-self-end rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold"
        style={situacao ? { background: 'var(--danger-bg)', color: 'var(--danger-fg)' } : { border: '1px solid var(--border)', color: 'var(--text-muted)' }}
      >
        {situacao ?? 'Sem bloqueio'}
      </span>
      <div className="col-span-2 flex flex-wrap items-end justify-between gap-x-[12px] gap-y-[8px]">
        <div className="min-w-0">
          <div className="font-display text-[19px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(soHoje ? item.valorVenceHoje : item.valorVencido)}
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{atraso}</div>
        </div>
        <div className="ml-auto flex gap-[8px]" onClick={(e) => e.stopPropagation()}>
        <Botao variante="secundaria" tamanho="sm" onClick={onAbrir}>Abrir caso</Botao>
        {(podeBloquear || (item.bloqueado && podeOperar)) && (
          <Botao
            variante={item.bloqueado ? 'secundaria' : 'perigo'}
            tamanho="sm"
            onClick={() => onAcao(item.bloqueado ? 'desbloquear' : 'bloquear', item)}
            disabled={ocupado}
          >
            {item.bloqueado ? 'Desbloquear' : 'Bloquear veículo'}
          </Botao>
        )}
        {(podeRecuperar || (item.emRecuperacao && podeOperar)) && (
          <Botao
            variante="secundaria"
            tamanho="sm"
            onClick={() => onAcao(item.emRecuperacao ? 'encerrar_recuperacao' : 'recuperar', item)}
            disabled={ocupado}
          >
            {item.emRecuperacao ? 'Encerrar recuperação' : 'Iniciar recuperação'}
          </Botao>
        )}
        </div>
      </div>
      <div className="col-span-2 flex flex-wrap gap-x-[14px] pt-[8px] text-[11.5px]" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        <span>próxima ação <strong style={{ color: 'var(--text-secondary)' }}>{proximaAcao}</strong></span>
        <span>CPF <strong style={{ color: 'var(--text-secondary)' }}>{item.titular.cpfCnpj}</strong></span>
      </div>
    </div>
  );
}

// Caso de cobrança (fluxo do operador, 18/08): o card do kanban abre as faturas
// vencidas do titular — valores CORRIGIDOS com mora (mesma fonte da renegociação,
// RAP007) — e o botão "Renegociar atraso" aciona o MESMO wizard da ficha.
function CasoModal({ item, onClose, onRenegociar }: { item: ReguaItem; onClose: () => void; onRenegociar: () => void }) {
  const navigate = useNavigate();
  const eleg = useQuery({
    queryKey: ['renegociacao-elegivel', item.contaId],
    queryFn: () => operacoesService.elegivelConta(item.contaId),
  });
  const faturas = eleg.data?.faturas ?? [];
  return (
    <Modal open onClose={onClose} title={`Caso de cobrança — ${item.titular.nome}`}>
      <div className="flex flex-col gap-[10px]">
        <div className="flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
            {item.diasAtraso > 0 ? `${resolverRaiaRegua(item.diasAtraso)?.rotulo ?? 'Vencida'} · ${item.diasAtraso} dia(s) de atraso` : item.parcelasVenceHoje > 0 ? 'Vence hoje' : 'Em intervenção'}
          </span>
          <span>{item.ativo?.modelo ?? '—'} · {item.ativo?.placa ?? 'sem placa'} · contrato {item.numero}</span>
          {item.bloqueado && <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>Veículo bloqueado</span>}
        </div>

        {eleg.isLoading ? (
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando faturas vencidas…</div>
        ) : faturas.length === 0 ? (
          <div className="rounded-[10px] p-[12px] text-[12.5px]" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>
            Sem faturas vencidas fora de acordo — o atraso pode já estar coberto por uma renegociação.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-[6px]">
              {faturas.map((f) => (
                <div key={f.faturaId} className="rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--surface-input)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-x-[8px] text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {/* Vencimento é coluna de DATA: dia do calendário gravado (Regra 15), nunca via Date+UTC. */}
                    <span>Fatura {f.numero ?? '—'}{f.dataVencimento ? ` · venc. ${dataBR(f.dataVencimento)}` : ''}</span>
                    <span className="tabular-nums">{formatCurrency(f.valorAtualizado)}</span>
                  </div>
                  <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {f.itens.map((it) => `${it.display} (${it.contratoNumero})`).join(', ')}
                    {f.encargosMora > 0 && ` · encargos de mora ${formatCurrency(f.encargosMora)}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-[8px] rounded-[10px] px-[12px] py-[8px] text-[13px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
              <span>Total corrigido ({faturas.length} fatura(s))</span>
              <span className="tabular-nums">{formatCurrency(eleg.data?.valorTotal ?? 0)}</span>
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-[8px] pt-[4px]">
          <Botao variante="secundaria" onClick={() => navigate(`/titulares/${eleg.data?.titularId ?? ''}`)} disabled={!eleg.data}>
            Abrir ficha do titular
          </Botao>
          <Botao variante="primaria" onClick={onRenegociar} disabled={faturas.length === 0}>
            Renegociar atraso
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

export function ReguaPage() {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [caso, setCaso] = useState<ReguaItem | null>(null);
  const [renegociando, setRenegociando] = useState<ReguaItem | null>(null);
  // Bloqueio pede confirmação (disponível a partir da raia "até 14 dias"; o desbloqueio é sempre manual).
  const [bloqueando, setBloqueando] = useState<ReguaItem | null>(null);
  // Recuperação do veículo também pede confirmação (raia "até 30 dias", doc 02 §29.1).
  const [recuperando, setRecuperando] = useState<ReguaItem | null>(null);
  function acaoRegua(acao: AcaoRegua, alvo: ReguaItem) {
    if (acao === 'bloquear') setBloqueando(alvo);
    else if (acao === 'recuperar') setRecuperando(alvo);
    else if (acao === 'encerrar_recuperacao') void comRefetch(() => reguaService.encerrarRecuperacao(alvo.id));
    else void comRefetch(() => reguaService.desbloquear(alvo.id));
  }
  // Raia selecionada nos cartões (null = quadro inteiro) e busca livre (31/10).
  const [raia, setRaia] = useState<ChaveColuna | null>(null);
  const [busca, setBusca] = useState('');
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const regua = useQuery({ queryKey: ['regua'], queryFn: () => reguaService.listar() });

  async function comRefetch(fn: () => Promise<void>) {
    setOcupado(true);
    try {
      await fn();
      await new Promise((r) => setTimeout(r, 600));
      await queryClient.invalidateQueries({ queryKey: ['regua'] });
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const todos = regua.data ?? [];
  const itens = todos.filter((i) => casaBusca(i, busca.trim()));
  const itensDaColuna = (chave: ChaveColuna) => itens.filter((i) => colunaDoItem(i) === chave);
  // Raia "Em intervenção" só aparece quando tem alguém.
  const colunasComDados = COLUNAS.filter((c) => c.chave !== 'intervencao' || todos.some((i) => colunaDoItem(i) === 'intervencao'));
  const raiaSelecionada = raia ? colunasComDados.find((c) => c.chave === raia) ?? null : null;

  return (
    <div className="flex h-full flex-col gap-[14px]">
      {/* Contadores por raia — clicar filtra o quadro ("todo dado é link"). */}
      <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4 xl:grid-cols-7">
        {colunasComDados.map((c) => {
          const daRaia = itensDaColuna(c.chave);
          const valor = daRaia.reduce((s, i) => s + (c.chave === 'hoje' ? i.valorVenceHoje : i.valorVencido), 0);
          return (
            <CartaoIndicador
              key={c.chave}
              rotulo={c.rotulo}
              tom={TOM_COLUNA[c.chave]}
              valor={regua.data ? String(daRaia.length) : '—'}
              detalhe={regua.data && daRaia.length > 0 ? `${formatCurrency(valor)} · ${c.marco}` : c.marco}
              onClick={() => setRaia((atual) => (atual === c.chave ? null : c.chave))}
              ativo={raia === c.chave}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF, placa ou contrato"
          aria-label="Buscar na régua"
          className="min-h-[30px] min-w-[200px] flex-1 rounded-full border px-[12px] text-[12.5px] sm:max-w-[320px]"
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
        <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
          {itens.length}{busca.trim() && itens.length !== todos.length ? ` de ${todos.length}` : ''} contrato(s) em régua de cobrança
          {raia && (
            <>
              {' · '}
              <button type="button" onClick={() => setRaia(null)} className="font-semibold" style={{ color: 'var(--accent)' }}>
                ver o quadro inteiro
              </button>
            </>
          )}
        </div>
        {/* Auditoria 15/09 (Bloco D): era o ÚNICO botão dev sem gate — aparecia
            em produção. Em produção a régua roda pelo cron diário. */}
        {podeOperar && FERRAMENTAS_TESTE && (
          <Botao
            variante="primaria"
            tamanho="sm"
            onClick={() => comRefetch(() => reguaService.rodar())}
            disabled={ocupado}
            carregando={ocupado}
            title="Dev: varre inadimplência e dispara cobrança automática (D+1/D+2)"
          >
            Rodar régua (dev)
          </Botao>
        )}
      </div>

      {raiaSelecionada ? (() => {
        // Raia expandida: painel na largura inteira, cartões em grade.
        const col = raiaSelecionada;
        const cards = itensDaColuna(col.chave);
        const cor = (col.estagio && REGUA_STAGE_COLORS[col.estagio]) || 'var(--text-label)';
        const total = cards.reduce((s, i) => s + (col.chave === 'hoje' ? i.valorVenceHoje : i.valorVencido), 0);
        return (
          <div className="flex flex-col rounded-card md:flex-1 md:overflow-auto" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderLeft: `4px solid ${cor}` }}>
            <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] px-[16px] py-[12px]" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
                  {col.rotulo} · {cards.length} contrato{cards.length === 1 ? '' : 's'}
                </div>
                <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{col.marco}</div>
              </div>
              {cards.length > 0 && (
                <div className="font-display text-[14px] font-bold tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {formatCurrency(total)} {col.chave === 'hoje' ? 'vencendo hoje' : 'em atraso nesta raia'}
                </div>
              )}
              <button type="button" onClick={() => setRaia(null)} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                ← todas as raias
              </button>
            </div>
            <div className="grid grid-cols-1 gap-[12px] p-[14px] md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
              {cards.length === 0 && (
                <div className="py-[24px] text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                  {busca.trim() ? 'Nada encontrado para a busca.' : 'Nenhum contrato nesta raia.'}
                </div>
              )}
              {cards.map((item) => (
                <CardLargo key={item.id} item={item} proximaAcao={col.marco} ocupado={ocupado} podeOperar={podeOperar} onAbrir={() => setCaso(item)} onAcao={acaoRegua} />
              ))}
            </div>
          </div>
        );
      })() : (
      /* Quadro: colunas lado a lado no desktop; empilhadas no celular (colunas
         vazias somem no celular para não virar uma fila de "Vazio"). */
      <div className="flex flex-col gap-[10px] md:flex-1 md:flex-row md:gap-[13px] md:overflow-x-auto md:pb-[8px]">
        {colunasComDados.map((col) => {
          const cards = itensDaColuna(col.chave);
          const cor = (col.estagio && REGUA_STAGE_COLORS[col.estagio]) || 'var(--text-label)';
          return (
            <div
              key={col.chave}
              className={`${cards.length === 0 ? 'hidden md:flex' : 'flex'} flex-col rounded-card md:w-[190px] md:flex-none`}
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-[8px] px-[13px] py-[11px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: cor }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {col.rotulo}
                  </div>
                  {col.marco && (
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }} title={col.marco}>
                      {col.marco}
                    </div>
                  )}
                </div>
                <div className="font-display text-[14px] font-bold tabular-nums" style={{ color: cor }}>
                  {cards.length}
                </div>
              </div>
              <div className="flex flex-col gap-[9px] p-[11px] md:flex-1 md:overflow-auto">
                {cards.length === 0 && (
                  <div className="py-[10px] text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Vazio
                  </div>
                )}
                {cards.map((item) => (
                  <Card key={item.id} item={item} ocupado={ocupado} podeOperar={podeOperar} onAbrir={() => setCaso(item)} onAcao={acaoRegua} />
                ))}
              </div>
            </div>
          );
        })}
        {!regua.isLoading && itens.length === 0 && (
          <div className="rounded-card px-[18px] py-[24px] text-center text-[12.5px] md:hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {busca.trim() ? 'Nada encontrado para a busca.' : 'Nenhum contrato em régua de cobrança.'}
          </div>
        )}
      </div>
      )}

      <ModalConfirmacao
        open={!!bloqueando}
        titulo="Bloquear veículo"
        confirmar="Bloquear veículo"
        carregando={ocupado}
        onCancelar={() => setBloqueando(null)}
        onConfirmar={async () => {
          if (!bloqueando) return;
          await comRefetch(() => reguaService.bloquear(bloqueando.id));
          setBloqueando(null);
        }}
      >
        {bloqueando && (
          <>
            Tem certeza? O veículo <strong style={{ color: 'var(--text-primary)' }}>{bloqueando.ativo?.modelo ?? '—'} · {bloqueando.ativo?.placa ?? 'sem placa'}</strong> de{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{bloqueando.titular.nome}</strong> ({bloqueando.diasAtraso} dias de atraso) será bloqueado. O desbloqueio é sempre manual.
          </>
        )}
      </ModalConfirmacao>
      <ModalConfirmacao
        open={!!recuperando}
        titulo="Iniciar recuperação do veículo"
        confirmar="Iniciar recuperação"
        variante="primaria"
        carregando={ocupado}
        onCancelar={() => setRecuperando(null)}
        onConfirmar={async () => {
          if (!recuperando) return;
          await comRefetch(() => reguaService.iniciarRecuperacao(recuperando.id));
          setRecuperando(null);
        }}
      >
        {recuperando && (
          <>
            Marca o início da retomada do <strong style={{ color: 'var(--text-primary)' }}>{recuperando.ativo?.modelo ?? '—'} · {recuperando.ativo?.placa ?? 'sem placa'}</strong> de{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{recuperando.titular.nome}</strong> ({recuperando.diasAtraso} dias de atraso). O contrato segue ativo; a rescisão, com o acerto dos 20%, é pedida na ficha do contrato depois da retomada.
          </>
        )}
      </ModalConfirmacao>
      {caso && (
        <CasoModal
          item={caso}
          onClose={() => setCaso(null)}
          onRenegociar={() => { setRenegociando(caso); setCaso(null); }}
        />
      )}
      {renegociando && (
        <RenegociacaoWizard
          contaId={renegociando.contaId}
          titular={renegociando.titular.nome}
          onClose={() => {
            setRenegociando(null);
            void queryClient.invalidateQueries({ queryKey: ['regua'] });
          }}
        />
      )}
    </div>
  );
}
