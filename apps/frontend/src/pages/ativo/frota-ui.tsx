import { diasCalendarioEntre } from '@azit/utils';
import { CONTA_SITUACAO_COLORS, type StatusColor } from '../../config/statusColors';
import type { PendenciasDoVeiculo, SituacaoDoVeiculo } from '../../services/ativo.service';
import { dataBR, hojeBrasilISO } from '../../lib/datas';

// Peças da frota e da ficha do veículo (doc 02 §25.7): a mesma leitura nas
// duas telas — situação do contrato, prazo da pendência e retornos gerados.

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function Chip({ texto, cor }: { texto: string; cor: StatusColor }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: cor.bg, color: cor.fg }}>
      {texto}
    </span>
  );
}

export function Placa({ placa }: { placa: string | null }) {
  if (!placa) return null;
  return (
    <span
      className="inline-block whitespace-nowrap rounded-[5px] px-[7px] py-[1px] font-mono text-[11.5px] font-semibold tracking-[0.06em]"
      style={{ border: '1px solid var(--border)', background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
    >
      {placa.length === 7 ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa}
    </span>
  );
}

/** "em atraso há 9 dias", "em dia", "em acordo", "bloqueado" — cor da situação da carteira. */
export function textoSituacao(s: SituacaoDoVeiculo): string {
  if (s.situacao === 'bloqueada') return 'veículo bloqueado';
  if (s.situacao === 'em_atraso') return `em atraso há ${plural(s.diasAtraso, 'dia', 'dias')}`;
  if (s.situacao === 'em_acordo') return 'em acordo';
  return 'em dia';
}

export function ChipSituacao({ s }: { s: SituacaoDoVeiculo }) {
  return <Chip texto={textoSituacao(s)} cor={CONTA_SITUACAO_COLORS[s.situacao] ?? CONTA_SITUACAO_COLORS.em_dia} />;
}

/** O prazo mais próximo da pendência, em texto: "vence em 4 dias", "indicar condutor até 30/11". */
export function prazoDaPendencia(p: PendenciasDoVeiculo['proximoPrazo']): { texto: string; tom: 'bad' | 'warn' | 'neutro' } | null {
  if (!p) return null;
  const dias = diasCalendarioEntre(hojeBrasilISO(), p.data);
  const dia = dataBR(p.data).slice(0, 5);
  const tom = dias < 0 ? 'bad' : dias <= 3 ? 'warn' : 'neutro';
  if (p.tipo === 'vencimento') {
    if (dias < 0) return { texto: `venceu há ${plural(-dias, 'dia', 'dias')}`, tom };
    if (dias === 0) return { texto: 'vence hoje', tom };
    return { texto: `vence em ${plural(dias, 'dia', 'dias')} · ${dia}`, tom };
  }
  if (p.tipo === 'indicacao') return { texto: dias < 0 ? `prazo de indicação venceu em ${dia}` : `indicar condutor até ${dia}`, tom };
  return { texto: dias < 0 ? `comprovante atrasado desde ${dia}` : `comprovante até ${dia}`, tom };
}

export const COR_TOM: Record<'bad' | 'warn' | 'neutro', string> = {
  bad: 'var(--danger-fg)',
  warn: 'var(--warn-fg)',
  neutro: 'var(--text-muted)',
};

/** Barra fina do retorno: quanto do investido já voltou (passa de 100% quando o carro já se pagou). */
export function BarraRetorno({ percentual, largura }: { percentual: number | null; largura?: number }) {
  return (
    <span
      className="block h-[6px] flex-none overflow-hidden rounded-full"
      style={{ width: largura ?? '100%', background: 'var(--surface-input)' }}
      role="img"
      aria-label={percentual === null ? 'sem investimento registrado' : `${percentual}% do investido já voltou`}
    >
      <i className="block h-full" style={{ width: `${Math.min(100, Math.max(0, percentual ?? 0))}%`, background: 'var(--ok-fg)' }} />
    </span>
  );
}
