import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, resolverEstagioRegua } from '@azit/utils';
import { reguaService, type ReguaItem } from '../services/regua.service';
import { operacoesService } from '../services/operacoes.service';
import { Modal } from '../components/Modal';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { Botao } from '../components/Botao';
import { CartaoIndicador, type TomIndicador } from '../components/CartaoIndicador';
import { REGUA_STAGE_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { dataBR } from '../lib/datas';

// Kanban por DIAS DE ATRASO (decisão Luís 31/08): colunas 1 a 7 dias + "+7";
// o caso se MOVE de coluna conforme o atraso da parcela vencida mais antiga.
// Os marcos operacionais da régua (cobrança D+1/D+2, bloqueio D+3, extrajudicial
// D+10, recuperação D+12) continuam como automação — aqui viram o subtítulo da
// coluna, e a cor vem do estágio correspondente (statusColors, Regra 9).
// Layout v2 (doc 03 §11, 30/10): contadores por estágio são cartões clicáveis
// que filtram o quadro; no celular as colunas empilham (sem rolagem lateral).
const COLUNAS_DIAS: { chave: string; rotulo: string; marco: string; estagio: string; corresponde: (d: number) => boolean }[] = [
  { chave: 'd1', rotulo: '1 dia', marco: 'Cobrança ativa (D+1)', estagio: 'd1', corresponde: (d) => d === 1 },
  { chave: 'd2', rotulo: '2 dias', marco: '2ª tentativa (D+2)', estagio: 'd2', corresponde: (d) => d === 2 },
  { chave: 'd3', rotulo: '3 dias', marco: 'Bloqueio disponível (D+3)', estagio: 'd3a7', corresponde: (d) => d === 3 },
  { chave: 'd4', rotulo: '4 dias', marco: '', estagio: 'd3a7', corresponde: (d) => d === 4 },
  { chave: 'd5', rotulo: '5 dias', marco: '', estagio: 'd3a7', corresponde: (d) => d === 5 },
  { chave: 'd6', rotulo: '6 dias', marco: '', estagio: 'd3a7', corresponde: (d) => d === 6 },
  { chave: 'd7', rotulo: '7 dias', marco: '', estagio: 'd3a7', corresponde: (d) => d === 7 },
  { chave: 'd7mais', rotulo: '+7 dias', marco: 'Extrajudicial (D+10) · Recuperação (D+12)', estagio: 'd7mais', corresponde: (d) => d > 7 },
];
// Dia representativo da coluna p/ resolver a cor pelo estágio (statusColors).
const DIA_COR: Record<string, number> = { d1: 1, d2: 2, d3: 3, d4: 4, d5: 5, d6: 6, d7: 7, d7mais: 12 };

// Estágios da régua para os cartões-indicadores (agrupam as colunas do quadro).
const ESTAGIOS: { chave: string; rotulo: string; detalhe: string; tom: TomIndicador }[] = [
  { chave: 'd1', rotulo: '1 dia de atraso', detalhe: 'cobrança ativa (D+1)', tom: 'warn' },
  { chave: 'd2', rotulo: '2 dias', detalhe: '2ª tentativa (D+2)', tom: 'warn' },
  { chave: 'd3a7', rotulo: '3 a 7 dias', detalhe: 'bloqueio disponível (D+3)', tom: 'bad' },
  { chave: 'd7mais', rotulo: 'Mais de 7 dias', detalhe: 'extrajudicial (D+10) · recuperação (D+12)', tom: 'neutro' },
];

function Card({ item, onAcao, onAbrir, ocupado, podeOperar }: { item: ReguaItem; onAcao: (acao: 'bloquear' | 'desbloquear', id: string) => void; onAbrir: () => void; ocupado: boolean; podeOperar: boolean }) {
  const podeBloquear = podeOperar && !item.bloqueado && item.diasAtraso >= 3;
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
        {item.bloqueado && (
          <span
            className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold"
            style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}
          >
            Bloqueado
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="font-display text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {formatCurrency(item.valorVencido)}
        </div>
        <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
          {item.diasAtraso}d · {item.parcelasVencidas}p
        </div>
      </div>
      {(podeBloquear || (item.bloqueado && podeOperar)) && (
        <Botao
          variante={item.bloqueado ? 'secundaria' : 'perigo'}
          tamanho="sm"
          className="mt-[10px] w-full"
          onClick={(e) => { e.stopPropagation(); onAcao(item.bloqueado ? 'desbloquear' : 'bloquear', item.id); }}
          disabled={ocupado}
        >
          {item.bloqueado ? 'Desbloquear' : 'Bloquear veículo (D+3)'}
        </Botao>
      )}
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
          <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{item.estagio} · {item.diasAtraso} dia(s) de atraso</span>
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
  // Estágio selecionado nos cartões (null = quadro inteiro).
  const [estagio, setEstagio] = useState<string | null>(null);
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

  const itens = regua.data ?? [];
  const colunasDoEstagio = (chave: string) => COLUNAS_DIAS.filter((c) => c.estagio === chave);
  const itensDoEstagio = (chave: string) => itens.filter((i) => colunasDoEstagio(chave).some((c) => c.corresponde(i.diasAtraso)));
  const colunasVisiveis = estagio ? colunasDoEstagio(estagio) : COLUNAS_DIAS;

  return (
    <div className="flex h-full flex-col gap-[14px]">
      {/* Indicadores por estágio — clicar filtra o quadro ("todo dado é link"). */}
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
        {ESTAGIOS.map((e) => {
          const doEstagio = itensDoEstagio(e.chave);
          const valor = doEstagio.reduce((s, i) => s + i.valorVencido, 0);
          return (
            <CartaoIndicador
              key={e.chave}
              rotulo={e.rotulo}
              tom={e.tom}
              valor={regua.data ? String(doEstagio.length) : '—'}
              detalhe={regua.data && doEstagio.length > 0 ? `${formatCurrency(valor)} vencido · ${e.detalhe}` : e.detalhe}
              onClick={() => setEstagio((atual) => (atual === e.chave ? null : e.chave))}
              ativo={estagio === e.chave}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
          {itens.length} contrato(s) em régua de cobrança
          {estagio && (
            <>
              {' · '}
              <button type="button" onClick={() => setEstagio(null)} className="font-semibold" style={{ color: 'var(--accent)' }}>
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

      {/* Quadro: colunas lado a lado no desktop; empilhadas no celular (colunas
          vazias somem no celular para não virar uma fila de "Vazio"). */}
      <div className="flex flex-col gap-[10px] md:flex-1 md:flex-row md:gap-[13px] md:overflow-x-auto md:pb-[8px]">
        {colunasVisiveis.map((col) => {
          const cards = itens.filter((i) => col.corresponde(i.diasAtraso));
          const estagioCor = resolverEstagioRegua(DIA_COR[col.chave]);
          const cor = (estagioCor && REGUA_STAGE_COLORS[estagioCor]) || 'var(--text-label)';
          return (
            <div
              key={col.chave}
              className={`${cards.length === 0 ? 'hidden md:flex' : 'flex'} flex-col rounded-card md:w-[200px] md:flex-none`}
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
                  <Card key={item.id} item={item} ocupado={ocupado} podeOperar={podeOperar} onAbrir={() => setCaso(item)} onAcao={(acao, id) =>
                    comRefetch(() => (acao === 'bloquear' ? reguaService.bloquear(id) : reguaService.desbloquear(id)))
                  } />
                ))}
              </div>
            </div>
          );
        })}
        {!regua.isLoading && (estagio ? itensDoEstagio(estagio).length === 0 : itens.length === 0) && (
          <div className="rounded-card px-[18px] py-[24px] text-center text-[12.5px] md:hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {estagio ? 'Nenhum contrato neste estágio.' : 'Nenhum contrato em régua de cobrança.'}
          </div>
        )}
      </div>

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
