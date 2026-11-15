import type { FaturaPublica } from '@azit/types';
import { formatCurrency, isoParaBR } from '@azit/utils';
import { faturaApi } from './api';
import { diaSemana, Marca, QrPix } from './comum';

// Fatura do modelo ANTIGO (ASAAS_NATIVO) — a página da F1, sem mudança (doc 02
// §32.2): a cobrança já existe no Asaas com multa e juros nativos, e o total é
// o que o PIX dela cobra. Faturas do modelo AZIT usam ContaAzit.tsx.
export function FaturaF1({ f, token, avisar }: { f: FaturaPublica; token: string; avisar: (m: string) => void }) {
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
              <div className="rec-f1" key={i}>
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
                  <QrPix payload={f.pix.payload} tamanho={184} />
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
