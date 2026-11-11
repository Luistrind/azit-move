import { useQuery, useQueryClient } from '@tanstack/react-query';
import { faturaService } from '../services/fatura.service';
import { Botao } from './Botao';
import { toast } from './Toast';
import { instanteBR } from '../lib/datas';

// Fatura Azit (doc 02 §32.7) — ações do OPERADOR sobre o link público da fatura:
// "Copiar link" e "Enviar pelo WhatsApp" (abre wa.me/<telefone do titular> com a
// mensagem pronta; sai do aparelho do operador, não depende da Meta). Cada uso
// fica registrado na fatura ("link enviado por <usuário> em <data>").
// Componente GENÉRICO: serve à ficha do titular e ao caso de cobrança; a
// variante compacta é a ação de linha.
export function LinkFaturaAcoes({ faturaId, compacto = false }: { faturaId: string; compacto?: boolean }) {
  const queryClient = useQueryClient();
  const det = useQuery({ queryKey: ['fatura-detalhe', faturaId], queryFn: () => faturaService.detalhe(faturaId) });
  const d = det.data;

  async function registrar(canal: 'whatsapp' | 'copia') {
    try {
      const novo = await faturaService.registrarEnvioLink(faturaId, canal);
      queryClient.setQueryData(['fatura-detalhe', faturaId], novo);
    } catch {
      /* o registro é rastro; a ação principal já aconteceu */
    }
  }

  async function copiar() {
    if (!d?.linkPublico) return;
    try {
      await navigator.clipboard.writeText(d.linkPublico);
      toast.sucesso('Link da fatura copiado.');
    } catch {
      toast.info(d.linkPublico);
    }
    void registrar('copia');
  }

  if (!d) return compacto ? null : <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando link…</div>;
  if (!d.linkPublico) return compacto ? null : <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Esta fatura ainda não tem link público.</div>;

  const wa = d.whatsappTitular && d.mensagemWhatsapp ? `https://wa.me/${d.whatsappTitular}?text=${encodeURIComponent(d.mensagemWhatsapp)}` : null;
  const botaoWa = wa ? (
    <a
      href={wa}
      target="_blank"
      rel="noreferrer"
      onClick={() => void registrar('whatsapp')}
      className={`inline-flex items-center rounded-[10px] font-semibold ${compacto ? 'h-[30px] px-[11px] text-[12px]' : 'h-[36px] px-[14px] text-[12.5px]'}`}
      style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', border: '1px solid transparent' }}
      title={`Abre o WhatsApp de ${d.titular.nome} com a mensagem pronta`}
    >
      {compacto ? 'WhatsApp' : 'Enviar pelo WhatsApp'}
    </a>
  ) : null;

  if (compacto) {
    return (
      <span className="inline-flex items-center gap-[6px]">
        <Botao variante="fantasma" tamanho="sm" onClick={copiar}>Copiar link</Botao>
        {botaoWa}
      </span>
    );
  }

  const ultimo = d.enviosLink[0];
  const quitada = d.status === 'paga' || d.status === 'paga_em_atraso';
  return (
    <div className="flex flex-col gap-[8px] rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="flex flex-col">
          <span className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>{quitada ? 'Fatura Azit — comprovante para o cliente' : 'Fatura Azit — link para o cliente'}</span>
          <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {quitada ? 'Página pública já como comprovante (fatura paga), com PDF.' : 'Página pública com itens, PIX e saldo ao vivo.'}{' '}
            {wa ? 'A mensagem já vai com nome, valor, vencimento e link.' : 'Titular sem WhatsApp cadastrado: copie o link.'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <Botao variante="secundaria" onClick={copiar}>Copiar link</Botao>
          {botaoWa}
        </div>
      </div>
      <code className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={d.linkPublico}>{d.linkPublico}</code>
      {ultimo ? (
        <span className="text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
          Último envio: {ultimo.canal === 'whatsapp' ? 'WhatsApp' : 'link copiado'} por {ultimo.usuario} em {instanteBR(ultimo.em)}
          {d.enviosLink.length > 1 ? ` · ${d.enviosLink.length} envios registrados` : ''}
        </span>
      ) : (
        <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Nenhum envio manual registrado ainda.</span>
      )}
    </div>
  );
}
