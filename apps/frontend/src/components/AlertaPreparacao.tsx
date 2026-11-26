import type { AlertaPreparacao as Alerta } from '../services/ativo.service';

// Alerta "Veículo em preparação" (doc 02 §25.8): o carro já pode ser simulado,
// proposto e atribuído à lista de espera, mas ainda não está pronto — e o
// contrato só é gerado depois de ele ser marcado como pronto na ficha.
// Genérico: `compacto` vira uma linha (vitrine, listas); o completo mostra o
// que falta e, quando vier, o motivo do bloqueio da formalização.
export function AlertaPreparacao({ alerta, compacto, mostrarMotivo }: { alerta: Alerta | null | undefined; compacto?: boolean; mostrarMotivo?: boolean }) {
  if (!alerta) return null;
  const falta = alerta.pendentes.length
    ? `falta ${alerta.pendentes.join(', ')}`
    : 'checklist completo, falta marcar como pronto';
  if (compacto) {
    return (
      <span className="text-[11.5px] font-semibold" style={{ color: 'var(--info-fg)' }}>
        Em preparação · {falta}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-[3px] rounded-[10px] px-[12px] py-[9px] text-[12.5px]" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>
      <b className="font-semibold">Veículo em preparação</b>
      <span>
        {alerta.pendentes.length ? (
          <>Falta: {alerta.pendentes.join(', ')} ({alerta.totalItens - alerta.pendentes.length} de {alerta.totalItens} itens prontos).</>
        ) : (
          <>Checklist completo — falta marcar como pronto na ficha do veículo.</>
        )}
        {alerta.oQueFalta ? <> Observação: {alerta.oQueFalta}</> : null}
      </span>
      {mostrarMotivo && <span>O contrato só é gerado depois que o veículo for marcado como pronto.</span>}
    </div>
  );
}
