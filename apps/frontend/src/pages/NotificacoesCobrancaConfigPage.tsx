import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificacaoCobrancaService as svc, type ParametrosNotificacao } from '../services/notificacaoCobranca.service';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { NOTIFICACAO_COBRANCA_STATUS_COLORS, FASE_POP_COLORS } from '../config/statusColors';

// Configurações → Notificações de cobrança (POP-COB-001, doc 02 §23): chave
// geral do disparo automático, modelo aprovado na Meta e os textos dos
// Anexos I–VI (editáveis, auditados, com o padrão do POP sempre restaurável).

const card = 'rounded-[14px] p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] w-full rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const btnP = 'rounded-[8px] bg-[var(--navy)] px-[14px] py-[8px] text-[12px] font-bold text-white disabled:opacity-40';
const btnS = 'rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold disabled:opacity-40';
const btnSStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <label className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</label>
);

// Gatilhos exibidos ao operador (mesma regra do motor — doc 02 §23 item 3).
const GATILHO: Record<string, string> = {
  '1': 'Automática · 1ª parcela vencida (D1)',
  '2': 'Automática · 72h após a 1ª, débito em aberto',
  '3': 'Automática · duas parcelas vencidas ao mesmo tempo',
  '4': 'Automática · 72h após a 3ª, com 2+ parcelas vencidas',
  '5': 'Automática · ao registrar a retomada do veículo',
  '6': 'Manual (direção) · atraso superior a 30 dias',
};

export function NotificacoesCobrancaConfigPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const editar = pode(['ADMIN', 'DIRETOR']);
  const q = useQuery({ queryKey: ['notificacoes-cobranca-parametros'], queryFn: () => svc.parametros() });
  const p: ParametrosNotificacao | undefined = q.data;
  const [etapa, setEtapa] = useState('1');
  const [rascunho, setRascunho] = useState<{ subtitulo: string; assunto: string; texto: string } | null>(null);
  const [modelo, setModelo] = useState({ nome: '', idioma: '' });
  const [ocupado, setOcupado] = useState(false);
  const [novoNumero, setNovoNumero] = useState('');

  useEffect(() => {
    if (p) setModelo({ nome: p.modeloNome, idioma: p.modeloIdioma });
  }, [p]);
  useEffect(() => {
    if (p) {
      const t = p.textos[etapa];
      setRascunho({ subtitulo: t.subtitulo, assunto: t.assunto, texto: t.texto });
    }
  }, [p, etapa]);

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      toast.sucesso(ok);
      await qc.invalidateQueries({ queryKey: ['notificacoes-cobranca-parametros'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!p || !rascunho) {
    return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>;
  }

  const atual = p.textos[etapa];
  const alterado = rascunho.assunto !== atual.assunto || rascunho.texto !== atual.texto || rascunho.subtitulo !== atual.subtitulo;
  const semProvedor = !p.provedor.configurado;

  return (
    <div className="flex flex-col gap-[14px] p-[24px]">
      <p className="max-w-[860px] text-[13px]" style={{ color: 'var(--text-muted)' }}>
        O sistema envia as notificações formais do <b>POP de Cobrança e Retomada</b> pelo WhatsApp dedicado, conforme o
        caso avança na régua. Cada notificação vai como <b>PDF anexado</b> a um modelo aprovado pela Meta, e o sistema
        guarda a prova: texto integral, código de verificação (SHA-256) e os horários de envio, entrega e leitura. {p.janela}.
      </p>

      {/* Chave geral */}
      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <div>
            <div className="font-display text-[14px] font-bold">Disparo automático</div>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {p.ativo ? 'Ligado — as notificações saem sozinhas quando o caso atinge cada gatilho.' : 'Desligado — nenhuma notificação sai automaticamente (a régua continua mostrando a próxima prevista).'}
            </div>
          </div>
          <div className="flex items-center gap-[8px]">
            <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold"
              style={p.ativo ? { background: NOTIFICACAO_COBRANCA_STATUS_COLORS.LIDA.bg, color: NOTIFICACAO_COBRANCA_STATUS_COLORS.LIDA.fg } : { background: FASE_POP_COLORS.juridico.bg, color: FASE_POP_COLORS.juridico.fg }}>
              {p.ativo ? 'LIGADO' : 'DESLIGADO'}
            </span>
            {editar && (
              <button className={btnP} disabled={ocupado}
                onClick={() => void rodar(() => svc.salvarParametros({ ativo: !p.ativo }), p.ativo ? 'Disparo automático desligado.' : 'Disparo automático ligado.')}>
                {p.ativo ? 'Desligar' : 'Ligar'}
              </button>
            )}
          </div>
        </div>
        {semProvedor && (
          <div className="mt-[10px] rounded-[10px] px-[12px] py-[8px] text-[12px]"
            style={{ background: NOTIFICACAO_COBRANCA_STATUS_COLORS.SIMULADA.bg, color: NOTIFICACAO_COBRANCA_STATUS_COLORS.SIMULADA.fg }}>
            {p.provedor.producao
              ? 'WhatsApp (Meta) sem credencial: em produção nada é simulado — as notificações ficam retidas até a configuração.'
              : 'WhatsApp (Meta) sem credencial: neste ambiente as notificações são SIMULADAS (registradas, com PDF e prova, mas não enviadas).'}{' '}
            <Link to="/configuracoes/integracoes" className="font-bold underline">Configurar em Integrações</Link>
          </div>
        )}
      </div>

      {/* Número real único em todos os ambientes (doc 02 §23 item 10) */}
      {!p.provedor.producao && (
        <div className={card} style={cardStyle}>
          <div className="font-display text-[14px] font-bold">Números autorizados para teste</div>
          <div className="mb-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Este é um ambiente de <b>teste</b> e usa o mesmo número de WhatsApp da produção. Por isso só estes números
            recebem mensagem de verdade. Qualquer outro destino fica registrado como SIMULADA e nada é enviado. Cadastre
            os clientes de teste com um destes WhatsApp. Lista vazia: nada sai deste ambiente.
          </div>
          <div className="mb-[10px] flex flex-wrap gap-[6px]">
            {p.numerosTeste.length === 0 && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum número autorizado.</span>}
            {p.numerosTeste.map((n) => (
              <span key={n} className="flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[12px] font-semibold tabular-nums" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                +{n}
                {editar && (
                  <button aria-label={`Remover +${n}`} disabled={ocupado} className="font-bold" style={{ color: 'var(--text-muted)' }}
                    onClick={() => void rodar(() => svc.salvarParametros({ numerosTeste: p.numerosTeste.filter((x) => x !== n) }), `+${n} removido.`)}>
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {editar && (
            <div className="flex max-w-[420px] gap-[8px]">
              <input className={inputCls} style={inputStyle} value={novoNumero} onChange={(e) => setNovoNumero(e.target.value)} placeholder="DDD + número, ex.: 27999998888" />
              <button className={btnP} disabled={ocupado || novoNumero.replace(/\D/g, '').length < 10}
                onClick={() => void rodar(async () => { await svc.salvarParametros({ numerosTeste: [...p.numerosTeste, novoNumero] }); setNovoNumero(''); }, 'Número autorizado.')}>
                Autorizar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modelo na Meta */}
      <div className={card} style={cardStyle}>
        <div className="font-display text-[14px] font-bold">Modelo de mensagem na Meta</div>
        <div className="mb-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Mensagem que a empresa inicia precisa de um modelo aprovado. Cadastre no WhatsApp Manager um modelo da categoria{' '}
          <b>Utilidade</b>, idioma português (BR), com <b>cabeçalho do tipo Documento</b> e este corpo:
        </div>
        <pre className="mb-[10px] whitespace-pre-wrap rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
{`Olá, {{1}}. Segue a {{2}} referente ao contrato nº {{3}}, veículo placa {{4}}. O documento anexo traz os detalhes e os prazos. Para regularizar ou negociar, responda esta mensagem.`}
        </pre>
        <div className="mb-[10px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {'{{1}}'} nome do comprador · {'{{2}}'} qual notificação (ex.: "1ª Notificação – Parcela em aberto") · {'{{3}}'} número do contrato · {'{{4}}'} placa. O PDF vai no cabeçalho.
        </div>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-[1fr_160px_auto]">
          <div className="flex flex-col gap-[4px]">
            <Lbl>Nome do modelo aprovado</Lbl>
            <input className={inputCls} style={inputStyle} value={modelo.nome} disabled={!editar} onChange={(e) => setModelo({ ...modelo, nome: e.target.value })} />
          </div>
          <div className="flex flex-col gap-[4px]">
            <Lbl>Idioma</Lbl>
            <input className={inputCls} style={inputStyle} value={modelo.idioma} disabled={!editar} onChange={(e) => setModelo({ ...modelo, idioma: e.target.value })} />
          </div>
          {editar && (
            <button className={`${btnP} self-end`} disabled={ocupado || (modelo.nome === p.modeloNome && modelo.idioma === p.modeloIdioma)}
              onClick={() => void rodar(() => svc.salvarParametros({ modeloNome: modelo.nome, modeloIdioma: modelo.idioma }), 'Modelo salvo.')}>
              Salvar modelo
            </button>
          )}
        </div>
      </div>

      {/* Textos dos Anexos I–VI */}
      <div className={card} style={cardStyle}>
        <div className="font-display text-[14px] font-bold">Textos das notificações</div>
        <div className="mb-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Anexos I–VI do POP. Os campos entre chaves são preenchidos pelo sistema no envio; linhas que começam com "- " viram itens.
        </div>
        <div className="mb-[12px] flex flex-wrap gap-[6px]">
          {Object.entries(p.etapas).map(([k, e]) => (
            <button key={k} onClick={() => setEtapa(k)} className="rounded-[8px] px-[12px] py-[6px] text-left text-[12px] font-semibold"
              style={etapa === k ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' }}>
              {e.titulo}
              <span className="block text-[10.5px] font-normal opacity-80">{e.resumo}{p.textos[k].personalizado ? ' · editado' : ''}</span>
            </button>
          ))}
        </div>
        <div className="mb-[10px] text-[12px]" style={{ color: 'var(--text-body)' }}>
          <b>Gatilho:</b> {GATILHO[etapa]} · Anexo {p.etapas[etapa].anexo} do POP{atual.personalizado ? ' · texto personalizado' : ' · texto padrão do POP'}
        </div>
        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-[8px]">
            <div className="flex flex-col gap-[4px]">
              <Lbl>Subtítulo</Lbl>
              <input className={inputCls} style={inputStyle} value={rascunho.subtitulo} disabled={!editar} onChange={(e) => setRascunho({ ...rascunho, subtitulo: e.target.value })} />
            </div>
            <div className="flex flex-col gap-[4px]">
              <Lbl>Assunto</Lbl>
              <input className={inputCls} style={inputStyle} value={rascunho.assunto} disabled={!editar} onChange={(e) => setRascunho({ ...rascunho, assunto: e.target.value })} />
            </div>
            <div className="flex flex-col gap-[4px]">
              <Lbl>Texto</Lbl>
              <textarea rows={18} className="w-full rounded-[8px] px-[10px] py-[8px] font-mono text-[12px] leading-[1.5]" style={inputStyle}
                value={rascunho.texto} disabled={!editar} onChange={(e) => setRascunho({ ...rascunho, texto: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-[8px]">
              <button className={btnS} style={btnSStyle} disabled={ocupado}
                onClick={() => void rodar(() => svc.previa(Number(etapa), rascunho), 'Prévia aberta em nova aba.')}>
                Ver prévia em PDF
              </button>
              {editar && (
                <>
                  <button className={btnP} disabled={ocupado || !alterado}
                    onClick={() => void rodar(() => svc.salvarParametros({ textos: { [etapa]: rascunho } }), `Texto da ${p.etapas[etapa].titulo} salvo.`)}>
                    Salvar texto
                  </button>
                  {alterado && (
                    <button className={btnS} style={btnSStyle} onClick={() => setRascunho({ subtitulo: atual.subtitulo, assunto: atual.assunto, texto: atual.texto })}>
                      Descartar alterações
                    </button>
                  )}
                  {atual.personalizado && (
                    <button className={btnS} style={btnSStyle} disabled={ocupado}
                      onClick={() => void rodar(() => svc.salvarParametros({ textos: { [etapa]: null } }), 'Texto padrão do POP restaurado.')}>
                      Restaurar padrão do POP
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="rounded-[10px] p-[10px] text-[11.5px]" style={{ background: 'var(--surface-input)' }}>
            <div className="mb-[6px] font-bold">Campos disponíveis</div>
            <div className="flex flex-col gap-[4px]">
              {p.variaveis.map((v) => (
                <div key={v.chave}>
                  <code className="font-semibold">{`{{${v.chave}}}`}</code>
                  <div style={{ color: 'var(--text-muted)' }}>{v.descricao}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
