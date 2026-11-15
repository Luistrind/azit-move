import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaturaPublica } from '@azit/types';
import { ErroFatura, faturaApi, tokenDaUrl } from './api';
import { linkWhatsapp, Marca } from './comum';
import { ContaAzit } from './ContaAzit';
import { FaturaF1 } from './FaturaF1';

// Fatura Azit — a página que o CLIENTE abre (doc 02 §32.2). Duas telas, pela
// fatura do link:
//   · modelo AZIT (Pix sob demanda, §32.4-A) → ContaAzit: a conta inteira, com
//     as faturas em aberto, Pix gerado na hora, outro valor e comprovante;
//   · modelo antigo (cobrança no Asaas) → FaturaF1: a página da F1, sem mudança.
// "Tempo real": render a cada abertura + consulta da situação a cada 30 s.
// Vocabulário sem "juros"/"taxa" (24/10).

const POLL_MS = 30_000;

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; status: number; mensagem: string; atendimento: { texto: string | null; link: string | null } | null }
  | { fase: 'ok'; fatura: FaturaPublica };

export function App() {
  const token = tokenDaUrl();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  // Assinatura da conta AZIT vista por último (pagamentos + Pix ativo + dia).
  const assinatura = useRef<string | null>(null);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const carregar = useCallback(async () => {
    if (!token) {
      setEstado({ fase: 'erro', status: 404, mensagem: 'Fatura indisponível', atendimento: null });
      return;
    }
    try {
      const fatura = await faturaApi.fatura(token);
      assinatura.current = fatura.conta?.assinatura ?? null;
      setEstado({ fase: 'ok', fatura });
    } catch (e) {
      const err = e instanceof ErroFatura ? e : new ErroFatura(0, 'Sem conexão. Tente de novo em instantes.');
      setEstado({ fase: 'erro', status: err.status, mensagem: err.message, atendimento: err.atendimento });
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Situação ao vivo: a cada 30 s (só com a aba visível); mudou → recarrega.
  // No modelo AZIT a comparação é pela assinatura da CONTA (um pagamento pode
  // quitar outra fatura, não a do link); no antigo, pelos campos da fatura.
  useEffect(() => {
    if (!token || estado.fase !== 'ok') return;
    const atual = estado.fatura;
    if (!atual.conta && atual.situacao === 'paga') return;
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await faturaApi.situacao(token);
        if (atual.conta) {
          if ((s.assinatura ?? null) !== assinatura.current) await carregar();
        } else if (s.situacao !== atual.situacao || s.valorPago !== atual.valorPago || s.totalHoje !== atual.totalHoje) {
          await carregar();
        }
      } catch {
        /* tenta no próximo ciclo */
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [token, estado, carregar]);

  if (estado.fase === 'carregando') return <Casca><div className="vazio">Carregando sua fatura…</div></Casca>;
  if (estado.fase === 'erro') return <Casca><Indisponivel status={estado.status} mensagem={estado.mensagem} atendimento={estado.atendimento} tentar={carregar} /></Casca>;
  return (
    <Casca>
      {estado.fatura.conta ? <ContaAzit f={estado.fatura} token={token!} avisar={avisar} /> : <FaturaF1 f={estado.fatura} token={token!} avisar={avisar} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </Casca>
  );
}

function Casca({ children }: { children: React.ReactNode }) {
  return <main className="fone">{children}</main>;
}

// Link inválido ou regenerado (§32.2): "Não encontramos esta fatura", sem
// revelar nada da conta, com o WhatsApp da Azit. Sem rede: tentar de novo.
function Indisponivel({ status, mensagem, atendimento, tentar }: { status: number; mensagem: string; atendimento: { texto: string | null; link: string | null } | null; tentar: () => void }) {
  const semRede = status === 0;
  const muitas = status === 429;
  return (
    <>
      <header className="topo">
        <Marca />
        <div className="meta"><span>Fatura Azit</span></div>
      </header>
      <div className="corpo">
        <section className="erro-box">
          <h3>{semRede ? 'Sem conexão' : muitas ? 'Muitas tentativas' : 'Não encontramos esta fatura'}</h3>
          <p>
            {semRede || muitas
              ? mensagem
              : 'O link pode estar incompleto ou ter sido substituído. Confira a mensagem que você recebeu ou fale com a Azit, que mandamos o link certo.'}
          </p>
          {(semRede || muitas) && <div className="acoes"><button className="btn btn-s" onClick={tentar}>Tentar de novo</button></div>}
        </section>
        {atendimento?.link && (
          <a className="btn btn-wa" href={linkWhatsapp(atendimento.link, 'Olá! O link da minha fatura não abriu. Podem me mandar de novo?')} target="_blank" rel="noopener noreferrer">
            Falar com a Azit no WhatsApp{atendimento.texto ? ` · ${atendimento.texto}` : ''}
          </a>
        )}
      </div>
      <footer className="rodape"><span><b>Azit Move</b> · Fatura Azit</span></footer>
    </>
  );
}
