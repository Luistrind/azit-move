import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { FaturaPublica } from '@azit/types';
import { formatCurrency, isoParaBR } from '@azit/utils';
import { ErroFatura, faturaApi, tokenDaUrl } from './api';

// Fatura Azit — a página que o CLIENTE abre (doc 02 §32.2, protótipo aprovado
// 10/11). Blocos nesta ordem: cabeçalho navy (marca, nº, situação, valor,
// vencimento) → Valores já recebidos → Itens da fatura (encargos no fim, total
// de hoje) → Pagar com PIX → ações (PDF) → rodapé. Paga: caixa de confirmação +
// comprovante. "Tempo real": render a cada abertura + consulta da situação a
// cada 30 s. Vocabulário sem "juros"/"taxa" (24/10).

const POLL_MS = 30_000;
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaSemana = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

type Estado = { fase: 'carregando' } | { fase: 'erro'; status: number; mensagem: string } | { fase: 'ok'; fatura: FaturaPublica };

export function App() {
  const token = tokenDaUrl();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const carregar = useCallback(async () => {
    if (!token) {
      setEstado({ fase: 'erro', status: 404, mensagem: 'Fatura indisponível' });
      return;
    }
    try {
      const fatura = await faturaApi.fatura(token);
      setEstado({ fase: 'ok', fatura });
    } catch (e) {
      const err = e instanceof ErroFatura ? e : new ErroFatura(0, 'Sem conexão. Tente de novo em instantes.');
      setEstado({ fase: 'erro', status: err.status, mensagem: err.message });
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Situação ao vivo: a cada 30 s (só com a aba visível); mudou → recarrega a página inteira.
  useEffect(() => {
    if (!token || estado.fase !== 'ok' || estado.fatura.situacao === 'paga') return;
    const atual = estado.fatura;
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await faturaApi.situacao(token);
        if (s.situacao !== atual.situacao || s.valorPago !== atual.valorPago || s.totalHoje !== atual.totalHoje) await carregar();
      } catch {
        /* tenta no próximo ciclo */
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [token, estado, carregar]);

  if (estado.fase === 'carregando') return <Casca><div className="vazio">Carregando sua fatura…</div></Casca>;
  if (estado.fase === 'erro') return <Casca><Indisponivel status={estado.status} mensagem={estado.mensagem} tentar={carregar} /></Casca>;
  return (
    <Casca>
      <Fatura f={estado.fatura} token={token!} avisar={avisar} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </Casca>
  );
}

function Casca({ children }: { children: React.ReactNode }) {
  return <main className="fone">{children}</main>;
}

function Marca() {
  return (
    <div className="marca">
      <img src="/marca-icone.png" alt="" width={32} height={32} />
      <div className="wm">azit<b>move</b></div>
    </div>
  );
}

function Indisponivel({ status, mensagem, tentar }: { status: number; mensagem: string; tentar: () => void }) {
  const semRede = status === 0;
  return (
    <>
      <header className="topo"><Marca /></header>
      <div className="corpo">
        <div className="pago-box neutro">
          <div className="g">{semRede ? 'Sem conexão' : 'Fatura indisponível'}</div>
          <div className="s">
            {semRede
              ? mensagem
              : 'Este link não corresponde a uma fatura disponível. Confira o link recebido ou fale com a Azit Move.'}
          </div>
          {semRede && <button className="btn btn-s" onClick={tentar}>Tentar de novo</button>}
        </div>
      </div>
    </>
  );
}

function Fatura({ f, token, avisar }: { f: FaturaPublica; token: string; avisar: (m: string) => void }) {
  const paga = f.situacao === 'paga';
  const vencida = f.situacao === 'vencida';
  const dias = f.encargo?.diasAtraso ?? 0;
  const classeStatus = paga ? 'st-paga' : f.pagaParcialmente ? 'st-parcial' : vencida ? 'st-vencida' : f.situacao === 'vence_hoje' ? 'st-hoje' : 'st-aberta';
  const textoStatus = paga ? 'Paga' : f.pagaParcialmente ? 'Paga parcialmente' : vencida ? 'Vencida' : f.situacao === 'vence_hoje' ? 'Vence hoje' : 'Em aberto';
  const totalPago = Math.max(f.valorPago, f.valorNominal);
  const venc = isoParaBR(f.vencimento);

  async function copiarPix() {
    if (!f.pix) return;
    try {
      await navigator.clipboard.writeText(f.pix.payload);
      avisar('Código PIX copiado. Cole no app do seu banco.');
    } catch {
      const el = document.getElementById('pixcode');
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
      avisar('Código selecionado. Use copiar no seu teclado.');
    }
  }

  return (
    <>
      <header className="topo">
        <Marca />
        <div className="meta">
          <span>Fatura nº {f.numero}</span>
          <span>{f.titular.documentoMascarado}</span>
        </div>
        <div className="ola">
          Olá, <strong>{f.titular.primeiroNome}</strong>. {paga ? 'Esta fatura está quitada.' : 'Aqui está o detalhe da sua fatura.'}
        </div>
        <span className={`status ${classeStatus}`}>{textoStatus}</span>
        <div className="total">
          <div className="k">{paga ? 'Total pago' : f.pagaParcialmente ? 'Saldo a pagar hoje' : 'Total a pagar'}</div>
          <div className="v num">{formatCurrency(paga ? totalPago : f.totalHoje)}</div>
          <div className="venc">
            {paga ? (
              <>Vencimento era {venc}{f.dataPagamento ? ` · paga em ${isoParaBR(f.dataPagamento)}` : ''}</>
            ) : vencida ? (
              <>Venceu em <em>{venc}</em>{dias > 0 ? ` · ${dias} ${dias === 1 ? 'dia' : 'dias'} de atraso` : ''}</>
            ) : f.situacao === 'vence_hoje' ? (
              <>Vence <em>hoje</em>, {diaSemana(f.vencimento)} {venc}</>
            ) : (
              <>Vence {diaSemana(f.vencimento)}, <em>{venc}</em></>
            )}
          </div>
        </div>
      </header>

      <div className="corpo">
        {f.pagamentos.length > 0 && (
          <section className="bloco">
            <h2>Valores já recebidos</h2>
            {f.pagamentos.map((p, i) => (
              <div className="rec" key={i}>
                <div className="d">Pagamento em {isoParaBR(p.data)}<span>{paga ? 'quitou a fatura' : 'abatido do saldo'}</span></div>
                <div className="v num">{formatCurrency(p.valor)}</div>
              </div>
            ))}
          </section>
        )}

        <section className="bloco">
          <h2>Itens da fatura</h2>
          <div className="lista">
            {f.itens.map((it, i) => (
              <div className="item" key={i}>
                <div className="n">
                  <div className="t">{it.titulo}</div>
                  {it.subtitulo && <div className="s">{it.subtitulo}</div>}
                </div>
                <div className="v num">{formatCurrency(it.valor)}</div>
              </div>
            ))}
            {f.encargo && (
              <>
                <div className="item encargo">
                  <div className="n"><div className="t">Multa por atraso</div><div className="s">cobrada uma única vez</div></div>
                  <div className={`v num ${f.encargo.multa ? '' : 'zero'}`}>{f.encargo.multa ? formatCurrency(f.encargo.multa) : 'R$ 0,00 (quitada)'}</div>
                </div>
                <div className="item encargo">
                  <div className="n"><div className="t">Atualização por dias de atraso</div><div className="s">{dias} {dias === 1 ? 'dia' : 'dias'} · calculada só sobre o saldo que falta pagar</div></div>
                  <div className="v num">{formatCurrency(f.encargo.atualizacao)}</div>
                </div>
              </>
            )}
          </div>
          {!paga && (
            <div className="soma"><span>Total hoje</span><span className="v num">{formatCurrency(f.totalHoje)}</span></div>
          )}
          {!paga && f.pagaParcialmente && (
            <div className="ajuda">Multa e atualização só incidem sobre o que ainda falta pagar. O que você já pagou não gera encargo novo.</div>
          )}
        </section>

        {paga ? (
          <>
            <div className="pago-box">
              <div className="g">Fatura paga. Obrigado, {f.titular.primeiroNome}!</div>
              <div className="s">Guarde o comprovante se precisar.</div>
            </div>
            <div className="acoes">
              <a className="btn btn-s" href={faturaApi.urlPdf(token)} target="_blank" rel="noreferrer">Baixar comprovante em PDF</a>
            </div>
          </>
        ) : (
          <>
            <section className="bloco">
              <h2>Pagar com PIX</h2>
              {f.pix ? (
                <div className="pix">
                  <QrPix payload={f.pix.payload} />
                  <div className="valor num">
                    {formatCurrency(f.pix.valor)}
                    <small>{f.pix.simulado ? 'Ambiente de teste: PIX simulado, não pague.' : 'QR Code e código abaixo valem para este valor'}</small>
                  </div>
                  <div className="copia">
                    <code id="pixcode">{f.pix.payload}</code>
                    <button className="btn btn-p" onClick={copiarPix}>Copiar</button>
                  </div>
                </div>
              ) : (
                <div className="ajuda">O código PIX desta fatura não está disponível neste momento. Tente de novo em instantes{f.atendimentoWhatsapp ? ' ou fale com a gente no WhatsApp' : ''}.</div>
              )}
            </section>
            <div className="acoes">
              <a className="btn btn-s" href={faturaApi.urlPdf(token)} target="_blank" rel="noreferrer">Exportar PDF</a>
            </div>
          </>
        )}
      </div>

      <footer className="rodape">
        <span>
          <b>Azit Move</b>
          {f.contratos.length > 0 && <> · Contrato {f.contratos.join(', ')}</>}
          {f.veiculo && <> · {f.veiculo.descricao}{f.veiculo.placa ? ` ${f.veiculo.placa}` : ''}</>}
        </span>
        {f.atendimentoWhatsapp && <span>Dúvidas sobre esta fatura: fale com a gente no WhatsApp <b>{f.atendimentoWhatsapp}</b>.</span>}
        <span>Esta página mostra o saldo em tempo real. Pagamento processado com segurança.</span>
      </footer>
    </>
  );
}

function QrPix({ payload }: { payload: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, payload, { width: 184, margin: 1, color: { dark: '#001029', light: '#ffffff' } });
  }, [payload]);
  return <canvas ref={ref} aria-label="QR Code PIX" />;
}
