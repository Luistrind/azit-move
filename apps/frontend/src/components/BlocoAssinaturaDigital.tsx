import { useQuery, useQueryClient } from '@tanstack/react-query';
import { originacaoService } from '../services/originacao.service';
import { toast } from './Toast';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { instanteBR } from '../lib/datas';
import { Botao } from './Botao';

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
    // Auditoria 15/09 (Bloco D): 'contrato-detalhe' não existia como chave —
    // invalida as queries reais do contrato e da proposta.
    await qc.invalidateQueries({ queryKey: ['contrato', contratoId] });
    await qc.invalidateQueries({ queryKey: ['proposta'] });
  }

  const ROTULO_STATUS: Record<string, string> = {
    enviado: 'Aguardando assinaturas',
    parcialmente_assinado: 'Parcialmente assinado',
    assinado: 'Assinado por todos',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
  };

  // Layout v2 (doc 03 §11): rótulo no eyebrow do sistema, ações em <Botao>,
  // cartões de signatário que empilham no celular; só tokens.
  return (
    <div className="rounded-[12px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>
          {titulo ?? 'Assinatura digital (ZapSign)'}{a.simulado ? ' — SIMULADA (sem credenciais no ambiente)' : ''}
        </span>
        {a.existe && (
          <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold"
            style={a.status === 'assinado' ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : a.status === 'recusado' ? { background: 'var(--danger-bg)', color: 'var(--danger-fg)' } : { background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
            {ROTULO_STATUS[a.status ?? ''] ?? a.status}
          </span>
        )}
      </div>

      {!a.existe ? (
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="min-w-0 flex-1 basis-[240px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Envia o documento congelado no snapshot para assinatura eletrônica — o documento é criado
            na ZapSign SÓ neste clique (cada criação consome o plano).
          </span>
          <Botao variante="primaria" tamanho="sm" disabled={ocupado}
            onClick={() => run(async () => { await originacaoService.enviarAssinaturaDigital(contratoId); await recarregar(); })}>
            Enviar para assinatura digital
          </Botao>
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {a.motivoRecusa && (
            <div className="rounded-[10px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
              Motivo da recusa: {a.motivoRecusa}
            </div>
          )}
          {(a.signatarios ?? []).map((s) => (
            <div key={s.papel + s.nome} className="flex flex-wrap items-center gap-[8px] rounded-[10px] px-[10px] py-[7px] text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
              <span className="min-w-0 flex-1 basis-[200px] font-semibold">{s.nome} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {PAPEL_ASSINATURA[s.papel] ?? s.papel}</span></span>
              {s.assinouEm ? (
                <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>✓ Assinou em {instanteBR(s.assinouEm)}</span>
              ) : (
                <>
                  <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: s.visualizouEm ? 'var(--warn-bg)' : 'var(--surface-muted)', color: s.visualizouEm ? 'var(--warn-ink)' : 'var(--text-body)' }}>
                    {s.visualizouEm ? 'Visualizou — não assinou' : 'Aguardando'}
                  </span>
                  <Botao tamanho="sm" variante="secundaria" onClick={() => { void navigator.clipboard.writeText(s.signUrl); toast.sucesso('Link de assinatura copiado.'); }}>
                    Copiar link
                  </Botao>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`Olá! Segue o link para assinatura do seu documento Azit Move: ${s.signUrl}`)}`} target="_blank" rel="noreferrer"
                    className="inline-flex h-[30px] items-center rounded-[10px] px-[11px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    Abrir WhatsApp
                  </a>
                </>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-[8px]">
            {a.pdfDisponivel && (
              <Botao tamanho="sm" variante="primaria" onClick={() => void originacaoService.baixarPdfAssinado(contratoId)}>
                Baixar documento assinado (PDF)
              </Botao>
            )}
            {a.status === 'recusado' && (
              <Botao tamanho="sm" variante="primaria" disabled={ocupado}
                onClick={() => run(async () => { await originacaoService.enviarAssinaturaDigital(contratoId); await recarregar(); })}>
                Reenviar para assinatura (novo documento — consome o plano)
              </Botao>
            )}
            {FERRAMENTAS_TESTE && a.status !== 'assinado' && (
              <Botao tamanho="sm" variante="secundaria" disabled={ocupado}
                onClick={() => run(async () => { await originacaoService.simularAssinaturaDigital(contratoId); await recarregar(); })}>
                Simular todos assinando (dev)
              </Botao>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
