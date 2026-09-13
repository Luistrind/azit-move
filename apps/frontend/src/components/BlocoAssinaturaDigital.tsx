import { useQuery, useQueryClient } from '@tanstack/react-query';
import { originacaoService } from '../services/originacao.service';
import { toast } from './Toast';

// ---------------------------------------------------------------------------
// Assinatura digital ZapSign F1 (doc 02 §21): cartão por signatário com link
// compartilhado PELO OPERADOR (copiar / WhatsApp). Sem credenciais no ambiente
// o provedor é simulado e o mock por botão continua valendo.
// Extraído da PropostaDetalhePage (13/09) para servir também ao TERMO do
// Reembolso Parcelado no detalhe do contrato (doc 02 §18.5) — componente
// genérico por props, nunca por caso de uso.
// ---------------------------------------------------------------------------
const PAPEL_ASSINATURA: Record<string, string> = {
  titular: 'Comprador',
  solidario: 'Comprador solidário',
  garantidor: 'Garantidor',
  testemunha1: 'Testemunha',
  testemunha2: 'Testemunha',
  azit: 'Azit (vendedora)',
};

export function BlocoAssinaturaDigital({ contratoId, ocupado, run, titulo }: {
  contratoId: string;
  ocupado: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  // Nome do documento na tela (ex.: "Termo do Reembolso Parcelado").
  titulo?: string;
}) {
  const qc = useQueryClient();
  const assinatura = useQuery({
    queryKey: ['assinatura-digital', contratoId],
    queryFn: () => originacaoService.statusAssinaturaDigital(contratoId),
    refetchInterval: 20000, // os webhooks mudam o estado sem ação local
  });
  const a = assinatura.data;
  if (!a) return null;

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: ['assinatura-digital', contratoId] });
    await qc.invalidateQueries({ queryKey: ['pacote-status'] });
    await qc.invalidateQueries({ queryKey: ['contrato-detalhe'] });
  }

  const ROTULO_STATUS: Record<string, string> = {
    enviado: 'Aguardando assinaturas',
    parcialmente_assinado: 'Parcialmente assinado',
    assinado: 'Assinado por todos',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
  };

  return (
    <div className="rounded-[8px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
        <span className="text-[12px] font-semibold">
          {titulo ?? 'Assinatura digital (ZapSign)'}{a.simulado ? ' — SIMULADA (sem credenciais no ambiente)' : ''}
        </span>
        {a.existe && (
          <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold"
            style={a.status === 'assinado' ? { background: '#eafaf1', color: '#1f9d5b' } : a.status === 'recusado' ? { background: '#fdecec', color: '#a12622' } : { background: '#fff3d6', color: '#8a5a00' }}>
            {ROTULO_STATUS[a.status ?? ''] ?? a.status}
          </span>
        )}
      </div>

      {!a.existe ? (
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Envia o documento congelado no snapshot para assinatura eletrônica — o documento é criado
            na ZapSign SÓ neste clique (cada criação consome o plano).
          </span>
          <button disabled={ocupado}
            onClick={() => run(async () => { await originacaoService.enviarAssinaturaDigital(contratoId); await recarregar(); })}
            className="h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
            Enviar para assinatura digital
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {a.motivoRecusa && (
            <div className="rounded-[8px] px-[10px] py-[6px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>
              Motivo da recusa: {a.motivoRecusa}
            </div>
          )}
          {(a.signatarios ?? []).map((s) => (
            <div key={s.papel + s.nome} className="flex flex-wrap items-center gap-[8px] rounded-[8px] px-[10px] py-[7px] text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border-light)' }}>
              <span className="min-w-[220px] font-semibold">{s.nome} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {PAPEL_ASSINATURA[s.papel] ?? s.papel}</span></span>
              {s.assinouEm ? (
                <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: '#eafaf1', color: '#1f9d5b' }}>✓ Assinou em {new Date(s.assinouEm).toLocaleDateString('pt-BR')}</span>
              ) : (
                <>
                  <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: s.visualizouEm ? '#fff3d6' : '#eef2f7', color: s.visualizouEm ? '#8a5a00' : '#5b6b7f' }}>
                    {s.visualizouEm ? 'Visualizou — não assinou' : 'Aguardando'}
                  </span>
                  <button onClick={() => { void navigator.clipboard.writeText(s.signUrl); toast.sucesso('Link de assinatura copiado.'); }}
                    className="h-[28px] rounded-[8px] px-[10px] text-[11.5px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                    Copiar link
                  </button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`Olá! Segue o link para assinatura do seu documento Azit Move: ${s.signUrl}`)}`} target="_blank" rel="noreferrer"
                    className="flex h-[28px] items-center rounded-[8px] px-[10px] text-[11.5px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                    Abrir WhatsApp
                  </a>
                </>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-[8px]">
            {a.pdfDisponivel && (
              <button onClick={() => void originacaoService.baixarPdfAssinado(contratoId)}
                className="h-[30px] rounded-[8px] px-[12px] text-[11.5px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
                Baixar documento assinado (PDF)
              </button>
            )}
            {a.status === 'recusado' && (
              <button disabled={ocupado}
                onClick={() => run(async () => { await originacaoService.enviarAssinaturaDigital(contratoId); await recarregar(); })}
                className="h-[30px] rounded-[8px] px-[12px] text-[11.5px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
                Reenviar para assinatura (novo documento — consome o plano)
              </button>
            )}
            {import.meta.env.DEV && a.status !== 'assinado' && (
              <button disabled={ocupado}
                onClick={() => run(async () => { await originacaoService.simularAssinaturaDigital(contratoId); await recarregar(); })}
                className="h-[30px] rounded-[8px] px-[12px] text-[11.5px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--navy)' }}>
                Simular todos assinando (dev)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
