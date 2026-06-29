import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, ESTAGIOS_REGUA, ROTULO_ESTAGIO } from '@azit/utils';
import { reguaService, type ReguaItem } from '../services/regua.service';
import { REGUA_STAGE_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';

function Card({ item, onAcao, ocupado, podeOperar }: { item: ReguaItem; onAcao: (acao: 'bloquear' | 'desbloquear', id: string) => void; ocupado: boolean; podeOperar: boolean }) {
  const podeBloquear = podeOperar && !item.bloqueado && item.diasAtraso >= 3;
  return (
    <div
      className="rounded-[10px] p-[12px]"
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
          onClick={() => onAcao(item.bloqueado ? 'desbloquear' : 'bloquear', item.id)}
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

export function ReguaPage() {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
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
        {ESTAGIOS_REGUA.map((estagio) => {
          const cards = itens.filter((i) => i.estagio === estagio);
          const cor = REGUA_STAGE_COLORS[estagio] ?? '#8694a4';
          return (
            <div
              key={estagio}
              className="flex w-[230px] flex-none flex-col rounded-card"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-[8px] px-[13px] py-[11px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: cor }} />
                <div className="flex-1">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {ROTULO_ESTAGIO[estagio]}
                  </div>
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
                  <Card key={item.id} item={item} ocupado={ocupado} podeOperar={podeOperar} onAcao={(acao, id) =>
                    comRefetch(() => (acao === 'bloquear' ? reguaService.bloquear(id) : reguaService.desbloquear(id)))
                  } />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
