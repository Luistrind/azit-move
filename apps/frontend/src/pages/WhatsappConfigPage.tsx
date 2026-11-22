import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaSistema, nomeMomentoLembrete } from '@azit/types';
import { formatarWhatsapp, normalizarWhatsapp } from '@azit/utils';
import { nomeSituacaoLembrete } from '@azit/types';
import { whatsappService, ParametrosWhatsapp, ModeloWhatsapp, ModeloPixWhatsapp } from '../services/whatsapp.service';
import { lembretesService, ResumoVarredura } from '../services/lembretes.service';
import { LEMBRETE_SITUACAO_COLORS } from '../config/statusColors';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { dataBR } from '../lib/datas';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela } from '../components/Tabela';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { instanteBR, horaBR } from '../lib/datas';
import { Botao } from '../components/Botao';
import { Chips } from '../components/Chips';
import { Secao } from '../components/Secao';
import { LinkArea } from '../components/LinkArea';

// Configuração › WhatsApp (doc 02 §23): a chave geral dos envios automáticos
// (desligada por padrão), os números autorizados fora de produção e o modelo
// aprovado na Meta de cada momento do lembrete. Parâmetros VERSIONADOS: salvar
// grava uma versão nova. As credenciais ficam em Configuração › Integrações.

const card = 'rounded-card flex flex-col gap-[12px] p-[18px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const pilula = 'inline-flex items-center rounded-full px-[10px] py-[2px] text-[11px] font-bold';
const muted = { color: 'var(--text-muted)' } as const;

type ModeloForm = { nome: string; idioma: string };
type Form = {
  ativo: boolean;
  numeros: string[];
  modelos: Record<string, ModeloForm>;
  // Pix copia e cola na mensagem (doc 02 §28.6).
  pixAtivo: boolean;
  recebedor: string;
  modelosPix: Record<string, ModeloForm>;
};

function formDe(p: ParametrosWhatsapp): Form {
  return {
    ativo: p.ativo,
    numeros: p.numerosAutorizados,
    modelos: Object.fromEntries(p.modelos.map((m) => [m.momento, { nome: m.nome, idioma: m.idioma }])),
    pixAtivo: p.pix.ativo,
    recebedor: p.pix.recebedor,
    modelosPix: Object.fromEntries(p.pix.modelos.map((m) => [m.momento, { nome: m.nome, idioma: m.idioma }])),
  };
}

// Modelo de pedido com Pix: só o nome muda por modelo (o idioma é um só para os dois).
function CartaoModeloPix({ modelo, valor, onChange }: { modelo: ModeloPixWhatsapp; valor: ModeloForm; onChange: (v: ModeloForm) => void }) {
  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] p-[14px]" style={{ border: '1px solid var(--border)' }}>
      <div className="text-[13px] font-bold">{nomeMomentoLembrete(modelo.momento)} — com Pix</div>
      <label className="flex min-w-0 flex-col gap-[4px] text-[12px]">
        <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nome do modelo na Meta</span>
        <input className={`${inputCls} w-full`} style={inputStyle} value={valor.nome} onChange={(e) => onChange({ ...valor, nome: e.target.value.trim() })} />
      </label>
      <details>
        <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>O que cadastrar na Meta</summary>
        <div className="mt-[10px] flex flex-col gap-[10px]">
          <div className="text-[12px]" style={muted}>
            Categoria <b>{modelo.cadastro.categoria}</b>, idioma <b>{valor.idioma}</b>, sem cabeçalho. Variáveis do corpo, nesta ordem:{' '}
            {modelo.cadastro.variaveis.map((v, i) => `{{${i + 1}}} ${v}`).join('; ')}. Botão: {modelo.cadastro.botaoTexto}. O link vai
            inteiro no texto, então o mesmo modelo serve para homologação e produção.
          </div>
          <Copiavel rotulo="Corpo da mensagem" texto={modelo.cadastro.corpo} />
        </div>
      </details>
    </div>
  );
}

function Copiavel({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div className="flex flex-col gap-[4px] text-[12px]">
      <span className="font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}</span>
      <div className="flex flex-wrap items-start gap-[8px]">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-[8px] px-[10px] py-[6px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>{texto}</code>
        <Botao tamanho="sm" variante="fantasma" onClick={() => { void navigator.clipboard.writeText(texto).then(() => toast.sucesso('Copiado.')); }}>copiar</Botao>
      </div>
    </div>
  );
}

function CartaoModelo({ modelo, valor, onChange }: { modelo: ModeloWhatsapp; valor: { nome: string; idioma: string }; onChange: (v: { nome: string; idioma: string }) => void }) {
  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] p-[14px]" style={{ border: '1px solid var(--border)' }}>
      <div className="text-[13px] font-bold">{nomeMomentoLembrete(modelo.momento)}</div>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-[1fr_140px]">
        <label className="flex min-w-0 flex-col gap-[4px] text-[12px]">
          <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nome do modelo na Meta</span>
          <input className={`${inputCls} w-full`} style={inputStyle} value={valor.nome} onChange={(e) => onChange({ ...valor, nome: e.target.value.trim() })} />
        </label>
        <label className="flex min-w-0 flex-col gap-[4px] text-[12px]">
          <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Idioma</span>
          <input className={`${inputCls} w-full`} style={inputStyle} value={valor.idioma} onChange={(e) => onChange({ ...valor, idioma: e.target.value.trim() })} />
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>O que cadastrar na Meta para este ambiente</summary>
        <div className="mt-[10px] flex flex-col gap-[10px]">
          <div className="text-[12px]" style={muted}>
            Categoria <b>{modelo.cadastro.categoria}</b>, idioma <b>{valor.idioma}</b>, sem cabeçalho. Variáveis do corpo, nesta ordem:{' '}
            {modelo.cadastro.variaveis.map((v, i) => `{{${i + 1}}} ${v}`).join('; ')}.
          </div>
          <Copiavel rotulo="Corpo da mensagem" texto={modelo.cadastro.corpo} />
          <Copiavel rotulo={`Botão "Acessar o site" — texto`} texto={modelo.cadastro.botaoTexto} />
          <Copiavel rotulo="Botão — endereço dinâmico" texto={modelo.cadastro.botaoUrl} />
          <div className="text-[12px]" style={muted}>
            No endereço, <code>{'{{1}}'}</code> é o {modelo.cadastro.botaoVariavel}. O domínio do botão é fixo no modelo: cada
            ambiente precisa do próprio modelo, com o próprio endereço.
          </div>
        </div>
      </details>
    </div>
  );
}

// O que os lembretes fizeram hoje, o que está retido e os últimos registros.
function LembretesRecentes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lembretes-resumo'], queryFn: () => lembretesService.resumo(), refetchInterval: 60_000 });
  const [rodando, setRodando] = useState(false);
  const [ultima, setUltima] = useState<ResumoVarredura | null>(null);
  const r = q.data;

  async function rodarAgora() {
    setRodando(true);
    try {
      const v = await lembretesService.varrerAgora();
      setUltima(v);
      if (!v.executada) toast.info(`Varredura não executada: ${v.motivo}.`);
      else toast.sucesso(`Varredura feita: ${v.enviados} enviado(s), ${v.simulados} simulado(s), ${v.retidos} retido(s), ${v.falhas} falha(s).`);
      await qc.invalidateQueries({ queryKey: ['lembretes-resumo'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setRodando(false);
    }
  }

  const contagem = (situacao: string) => r?.hoje[situacao] ?? 0;
  return (
    <div className={card} style={cardStyle}>
      <Secao titulo="Lembretes de pagamento — acompanhamento" tag={r ? `${r.titularesComLembrete} titular(es) com o lembrete ligado` : undefined}>
        <div className="flex flex-col gap-[12px]">
          {!r ? (
            <div className="text-[12.5px]" style={muted}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>
          ) : (
            <>
              <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
                Hoje ({dataBR(r.dia)}): {contagem('ENVIADO') + contagem('ENTREGUE') + contagem('LIDO')} enviado(s), {contagem('SIMULADO')} simulado(s),{' '}
                {contagem('RETIDO')} retido(s), {contagem('FALHOU')} falha(s).
              </div>
              {r.retidos > 0 && (
                <div className="rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
                  {r.retidos} lembrete(s) retido(s) por falta de credencial. Os de hoje saem sozinhos na próxima varredura depois que a credencial
                  for cadastrada; os de dias anteriores não são enviados com atraso.
                </div>
              )}
              <Tabela
                colunas={[
                  { chave: 'titular', titulo: 'Titular', celular: 'titulo', render: (l) => <LinkArea to={`/titulares/${l.titular.id}`} area={[AreaSistema.PESSOAS, AreaSistema.COMERCIAL]} className="font-semibold hover:underline">{l.titular.nome}</LinkArea> },
                  { chave: 'fatura', titulo: 'Fatura', celular: 'subtitulo', classe: 'tabular-nums', render: (l) => `#${l.faturaNumero} · vence ${dataBR(l.vencimento)}` },
                  { chave: 'momento', titulo: 'Lembrete', celular: 'campo', render: (l) => nomeMomentoLembrete(l.momento) },
                  { chave: 'situacao', titulo: 'Situação', celular: 'destaque', render: (l) => <StatusBadge label={nomeSituacaoLembrete(l.situacao)} colors={LEMBRETE_SITUACAO_COLORS} /> },
                  { chave: 'quando', titulo: 'Registrado', celular: 'campo', classe: 'tabular-nums', render: (l) => `${instanteBR(l.registradoEm)} ${horaBR(l.registradoEm)}` },
                ]}
                linhas={r.ultimos}
                chave={(l) => l.id}
                vazio="Nenhum lembrete registrado ainda."
              />
            </>
          )}
          {FERRAMENTAS_TESTE && (
            <div className="flex flex-wrap items-center gap-[10px]">
              <Botao variante="secundaria" carregando={rodando} onClick={() => void rodarAgora()}>Teste: rodar a varredura agora</Botao>
              <span className="text-[12px]" style={muted}>
                Ignora a janela de horário. A regra de envio continua valendo: neste ambiente só sai de verdade para número autorizado.
                {ultima?.executada ? ` Última: ${ultima.candidatas} fatura(s) avaliada(s), ${ultima.ignoradas} sem lembrete a enviar.` : ''}
              </span>
            </div>
          )}
        </div>
      </Secao>
    </div>
  );
}

export function WhatsappConfigPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['whatsapp-parametros'], queryFn: () => whatsappService.parametros() });
  const p = q.data;
  const [form, setForm] = useState<Form | null>(null);
  const [novoNumero, setNovoNumero] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (p) setForm(formDe(p));
  }, [p]);

  if (!p || !form) return <div className="text-[13px]" style={muted}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>;

  const producao = p.ambiente.producao;
  const semCredencial = !p.ambiente.credencialConfigurada;
  // Produção nunca simula: sem credencial a chave nem liga (doc 02 §23.1).
  const naoPodeLigar = producao && semCredencial && !p.ativo;
  const mudou = JSON.stringify(form) !== JSON.stringify(formDe(p));

  function adicionarNumero() {
    const n = normalizarWhatsapp(novoNumero);
    if (!n) {
      toast.erro('Número inválido. Use DDD + número, por exemplo 11 98765-4321.');
      return;
    }
    if (form && !form.numeros.includes(n)) setForm({ ...form, numeros: [...form.numeros, n] });
    setNovoNumero('');
  }

  async function salvar() {
    if (!form) return;
    setOcupado(true);
    try {
      const d2 = form.modelos.D_MENOS_2;
      const d0 = form.modelos.D_ZERO;
      const atraso = form.modelos.D_MAIS_2;
      const pixD2 = form.modelosPix.D_MENOS_2;
      const pixD0 = form.modelosPix.D_ZERO;
      await whatsappService.salvarParametros({
        ativo: form.ativo,
        numerosAutorizados: form.numeros,
        modeloD2Nome: d2?.nome,
        modeloD2Idioma: d2?.idioma,
        modeloD0Nome: d0?.nome,
        modeloD0Idioma: d0?.idioma,
        modeloAtrasoNome: atraso?.nome,
        modeloAtrasoIdioma: atraso?.idioma,
        modeloPixD2Nome: pixD2?.nome,
        modeloPixD0Nome: pixD0?.nome,
        modeloPixIdioma: pixD2?.idioma,
        pixNoLembrete: form.pixAtivo,
        recebedorPix: form.recebedor,
      });
      toast.sucesso('Parâmetros do WhatsApp salvos em uma nova versão.');
      await qc.invalidateQueries({ queryKey: ['whatsapp-parametros'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="text-[13px]" style={muted}>
        Regras do número de WhatsApp da Azit: quando o sistema envia sozinho, para quem pode enviar neste ambiente e quais
        modelos aprovados na Meta usar. O que o cliente responder é atendido em Carteira › Conversas do WhatsApp.
      </p>

      <div className={card} style={cardStyle}>
        <Secao
          titulo="Situação deste ambiente"
          acao={
            <span className="flex flex-wrap gap-[6px]">
              <span className={pilula} style={producao ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
                {producao ? 'PRODUÇÃO' : 'AMBIENTE DE TESTE'}
              </span>
              <span className={pilula} style={semCredencial ? (producao ? { background: 'var(--danger-bg)', color: 'var(--danger-fg)' } : { background: 'var(--info-bg)', color: 'var(--info-fg)' }) : { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>
                {semCredencial ? 'SEM CREDENCIAL DA META' : 'CREDENCIAL CONFIGURADA'}
              </span>
            </span>
          }
        >
          <div className="flex flex-col gap-[6px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            <div>
              {producao
                ? semCredencial
                  ? 'Sem o id do número e o token de acesso, nada é enviado: os lembretes ficam retidos. Produção nunca simula.'
                  : 'Os lembretes saem de verdade para o WhatsApp do cadastro de cada titular com o lembrete ligado.'
                : semCredencial
                  ? 'Sem credencial, tudo o que seria enviado fica registrado como simulado. Nada sai deste ambiente.'
                  : 'O número é o mesmo da produção. Só recebem de verdade os números autorizados abaixo; qualquer outro destino fica registrado como simulado.'}
            </div>
            <div style={muted}>
              {p.versao === 0
                ? 'Parâmetros padrão — nenhuma versão salva ainda.'
                : `Versão ${p.versao} em vigor, salva por ${p.alteradoPor ?? 'usuário removido'} em ${instanteBR(p.alteradoEm)} às ${p.alteradoEm ? horaBR(p.alteradoEm) : ''}.`}{' '}
              <LinkArea to="/configuracoes/integracoes" area={AreaSistema.CONFIGURACOES} className="font-semibold underline">Credenciais da Meta em Integrações →</LinkArea>
            </div>
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Envios automáticos — lembretes de pagamento">
          <div className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-center gap-[10px]">
              <Chips
                todos={null}
                itens={[{ chave: 'desligado', rotulo: 'Desligado' }, { chave: 'ligado', rotulo: 'Ligado' }]}
                valor={form.ativo ? 'ligado' : 'desligado'}
                onChange={(k) => {
                  if (k === 'ligado' && naoPodeLigar) {
                    toast.erro('Cadastre o id do número e o token de acesso em Configuração › Integrações antes de ligar.');
                    return;
                  }
                  if (k) setForm({ ...form, ativo: k === 'ligado' });
                }}
              />
              {naoPodeLigar && <span className="text-[12px]" style={{ color: 'var(--danger-fg)' }}>Não é possível ligar sem a credencial da Meta.</span>}
            </div>
            <div className="text-[12px]" style={muted}>
              Ligado, o sistema envia o lembrete 2 dias antes do vencimento e no dia do vencimento e, se a fatura continuar sem
              pagamento, um aviso de atraso 2 dias depois — todos os dias, das {p.janela.inicio}h às {p.janela.fim}h (horário de Brasília),
              com o link da Fatura Azit. Depois do aviso de atraso o sistema não manda mais nada: o caso é da cobrança. Só recebe o
              titular com o lembrete ligado na ficha e com fatura em aberto. Desligado, nenhum lembrete é gerado. As respostas em
              Conversas não dependem desta chave.
            </div>
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Números autorizados neste ambiente">
          {producao ? (
            <div className="text-[12.5px]" style={muted}>
              Esta lista só vale fora de produção. Aqui, cada lembrete vai para o WhatsApp do cadastro do titular.
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              <div className="text-[12px]" style={muted}>
                Cadastre os clientes de teste com o seu WhatsApp ou o de um colega e autorize o número aqui. Lista vazia: nada real sai deste ambiente.
              </div>
              <div className="flex flex-wrap gap-[6px]">
                {form.numeros.length === 0 && <span className="text-[12.5px]" style={muted}>Nenhum número autorizado.</span>}
                {form.numeros.map((n) => (
                  <span key={n} className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[12px] tabular-nums" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                    {formatarWhatsapp(n)}
                    <button type="button" aria-label={`Remover ${formatarWhatsapp(n)}`} className="font-bold" style={{ color: 'var(--danger-fg)' }}
                      onClick={() => setForm({ ...form, numeros: form.numeros.filter((x) => x !== n) })}>×</button>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-[8px]">
                <input className={`${inputCls} min-w-0 flex-1 sm:max-w-[240px]`} style={inputStyle} value={novoNumero} inputMode="tel"
                  placeholder="DDD + número" onChange={(e) => setNovoNumero(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') adicionarNumero(); }} />
                <Botao variante="secundaria" disabled={!novoNumero.trim()} onClick={adicionarNumero}>Autorizar número</Botao>
              </div>
            </div>
          )}
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Modelos de mensagem aprovados na Meta">
          <div className="flex flex-col gap-[12px]">
            <div className="text-[12px]" style={muted}>
              Mensagem iniciada pela empresa só sai com modelo aprovado. Informe o nome exato de cada modelo deste ambiente. O texto
              é provisório até a revisão do jurídico; se mudar na Meta, avise para o sistema acompanhar.
            </div>
            {p.modelos.map((m) => (
              <CartaoModelo key={m.momento} modelo={m} valor={form.modelos[m.momento] ?? { nome: m.nome, idioma: m.idioma }}
                onChange={(v) => setForm({ ...form, modelos: { ...form.modelos, [m.momento]: v } })} />
            ))}
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Pix copia e cola na mensagem">
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-[10px]">
              <Chips
                todos={null}
                itens={[{ chave: 'desligado', rotulo: 'Desligado' }, { chave: 'ligado', rotulo: 'Ligado' }]}
                valor={form.pixAtivo ? 'ligado' : 'desligado'}
                onChange={(k) => { if (k) setForm({ ...form, pixAtivo: k === 'ligado' }); }}
              />
            </div>
            <div className="text-[12px]" style={muted}>
              Ligado, quem tem <b>uma única fatura em aberto</b> recebe no lembrete de 2 dias antes e no do dia do vencimento um cartão com o
              valor e o botão <b>Copiar código Pix</b>, além do link da fatura no texto. O código vale até 23h59 do dia do vencimento e é o
              mesmo nos dois lembretes. Quem tem duas ou mais faturas recebe só o link e escolhe o que pagar na página. O aviso de atraso
              nunca leva Pix. Se o modelo com Pix não estiver aprovado ou o Pix não puder ser gerado, o lembrete sai só com o link.
            </div>
            <label className="flex min-w-0 flex-col gap-[4px] text-[12px] sm:max-w-[420px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nome de quem recebe, no cartão do Pix</span>
              <input className={`${inputCls} w-full`} style={inputStyle} value={form.recebedor} maxLength={100}
                onChange={(e) => setForm({ ...form, recebedor: e.target.value })} />
              <span style={muted}>A razão social do cartão CNPJ. O app do banco do cliente mostra, de qualquer forma, o titular da conta que recebe a chave Pix.</span>
            </label>
            {p.pix.modelos.map((m) => (
              <CartaoModeloPix key={m.momento} modelo={m} valor={form.modelosPix[m.momento] ?? { nome: m.nome, idioma: m.idioma }}
                onChange={(v) => setForm({ ...form, modelosPix: { ...form.modelosPix, [m.momento]: v } })} />
            ))}
          </div>
        </Secao>
      </div>

      <Botao variante="primaria" className="self-start" carregando={ocupado} disabled={!mudou} onClick={() => void salvar()}>
        Salvar nova versão
      </Botao>

      <LembretesRecentes />
    </div>
  );
}
