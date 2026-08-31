import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, resolverEstagioRegua } from '@azit/utils';
import { reguaService, type ReguaItem } from '../services/regua.service';
import { operacoesService } from '../services/operacoes.service';
import { Modal } from '../components/Modal';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { REGUA_STAGE_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';

// Kanban por DIAS DE ATRASO (decisão Luís 31/08): colunas 1 a 7 dias + "+7";
// o caso se MOVE de coluna conforme o atraso da parcela vencida mais antiga.
// Os marcos operacionais da régua (cobrança D+1/D+2, bloqueio D+3, extrajudicial
// D+10, recuperação D+12) continuam como automação — aqui viram o subtítulo da
// coluna, e a cor vem do estágio correspondente (statusColors, Regra 9).
const COLUNAS_DIAS: { chave: string; rotulo: string; marco: string; corresponde: (d: number) => boolean }[] = [
  { chave: 'd1', rotulo: '1 dia', marco: 'Cobrança ativa (D+1)', corresponde: (d) => d === 1 },
  { chave: 'd2', rotulo: '2 dias', marco: '2ª tentativa (D+2)', corresponde: (d) => d === 2 },
  { chave: 'd3', rotulo: '3 dias', marco: 'Bloqueio disponível (D+3)', corresponde: (d) => d === 3 },
  { chave: 'd4', rotulo: '4 dias', marco: '', corresponde: (d) => d === 4 },
  { chave: 'd5', rotulo: '5 dias', marco: '', corresponde: (d) => d === 5 },
  { chave: 'd6', rotulo: '6 dias', marco: '', corresponde: (d) => d === 6 },
  { chave: 'd7', rotulo: '7 dias', marco: '', corresponde: (d) => d === 7 },
  { chave: 'd7mais', rotulo: '+7 dias', marco: 'Extrajudicial (D+10) · Recuperação (D+12)', corresponde: (d) => d > 7 },
];
// Dia representativo da coluna p/ resolver a cor pelo estágio (statusColors).
const DIA_COR: Record<string, number> = { d1: 1, d2: 2, d3: 3, d4: 4, d5: 5, d6: 6, d7: 7, d7mais: 12 };

function Card({ item, onAcao, onAbrir, ocupado, podeOperar }: { item: ReguaItem; onAcao: (acao: 'bloquear' | 'desbloquear', id: string) => void; onAbrir: () => void; ocupado: boolean; podeOperar: boolean }) {
  const podeBloquear = podeOperar && !item.bloqueado && item.diasAtraso >= 3;
  return (
    <div
      onClick={onAbrir}
      role="button"
      title="Abrir o caso de cobrança"
      className="cursor-pointer rounded-[10px] p-[12px] transition-shadow hover:shadow-[0_4px_14px_rgba(0,16,41,.12)]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {item.titular.nome}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {item.ativo.placa ?? '—'}
          </div>
          <div className="mb-[9px] text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {item.ativo.modelo ?? '—'} · {item.numero}
          </div>
        </div>
        {item.bloqueado && (
          <span
            className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold"
            style={{ background: '#fdeceb', color: '#e0413c' }}
          >
            Bloqueado
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="font-display text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>
          {formatCurrency(item.valorVencido)}
        </div>
        <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
          {item.diasAtraso}d · {item.parcelasVencidas}p
        </div>
      </div>
      {(podeBloquear || (item.bloqueado && podeOperar)) && (
        <button
          onClick={(e) => { e.stopPropagation(); onAcao(item.bloqueado ? 'desbloquear' : 'bloquear', item.id); }}
          disabled={ocupado}
          className="mt-[10px] w-full rounded-[7px] py-[6px] text-[11.5px] font-semibold"
          style={{
            background: item.bloqueado ? 'var(--surface-input)' : '#e0413c',
            color: item.bloqueado ? 'var(--text-body)' : '#fff',
            opacity: ocupado ? 0.6 : 1,
          }}
        >
          {item.bloqueado ? 'Desbloquear' : 'Bloquear veículo (D+3)'}
        </button>
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
          <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: '#fdeceb', color: '#c0392b' }}>{item.estagio} · {item.diasAtraso} dia(s) de atraso</span>
          <span>{item.ativo.modelo ?? '—'} · {item.ativo.placa ?? 'sem placa'} · contrato {item.numero}</span>
          {item.bloqueado && <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: '#fdeceb', color: '#e0413c' }}>Veículo bloqueado</span>}
        </div>

        {eleg.isLoading ? (
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando faturas vencidas…</div>
        ) : faturas.length === 0 ? (
          <div className="rounded-[10px] p-[12px] text-[12.5px]" style={{ background: '#e8f7ef', color: '#1f9d5b' }}>
            Sem faturas vencidas fora de acordo — o atraso pode já estar coberto por uma renegociação.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-[6px]">
              {faturas.map((f) => (
                <div key={f.faturaId} className="rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--surface-input)' }}>
                  <div className="flex items-center justify-between text-[12.5px] font-bold">
                    <span>Fatura {f.numero ?? '—'}{f.dataVencimento ? ` · venc. ${new Date(f.dataVencimento).toLocaleDateString('pt-BR')}` : ''}</span>
                    <span className="tabular-nums">{formatCurrency(f.valorAtualizado)}</span>
                  </div>
                  <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {f.itens.map((it) => `${it.display} (${it.contratoNumero})`).join(', ')}
                    {f.encargosMora > 0 && ` · encargos de mora ${formatCurrency(f.encargosMora)}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[8px] text-[13px] font-bold" style={{ background: '#fdeceb', color: '#c0392b' }}>
              <span>Total corrigido ({faturas.length} fatura(s))</span>
              <span className="tabular-nums">{formatCurrency(eleg.data?.valorTotal ?? 0)}</span>
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-[8px] pt-[4px]">
          <button onClick={() => navigate(`/titulares/${eleg.data?.titularId ?? ''}`)} disabled={!eleg.data}
            className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
            Abrir ficha do titular
          </button>
          <button onClick={onRenegociar} disabled={faturas.length === 0}
            className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
            Renegociar atraso
          </button>
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

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
          {itens.length} contrato(s) em régua de cobrança
        </div>
        {podeOperar && (
          <button
            onClick={() => comRefetch(() => reguaService.rodar())}
            disabled={ocupado}
            className="rounded-[8px] px-[14px] py-[7px] text-[12px] font-semibold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}
            title="Dev: varre inadimplência e dispara cobrança automática (D+1/D+2)"
          >
            {ocupado ? 'Processando…' : 'Rodar régua (dev)'}
          </button>
        )}
      </div>

      <div className="flex flex-1 gap-[13px] overflow-x-auto pb-[8px]">
        {COLUNAS_DIAS.map((col) => {
          const cards = itens.filter((i) => col.corresponde(i.diasAtraso));
          const estagioCor = resolverEstagioRegua(DIA_COR[col.chave]);
          const cor = (estagioCor && REGUA_STAGE_COLORS[estagioCor]) || '#8694a4';
          return (
            <div
              key={col.chave}
              className="flex w-[200px] flex-none flex-col rounded-card"
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
                <div className="font-display text-[14px] font-bold" style={{ color: cor }}>
                  {cards.length}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-[9px] overflow-auto p-[11px]">
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
