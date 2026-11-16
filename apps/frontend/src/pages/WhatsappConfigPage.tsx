import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaSistema, nomeMomentoLembrete } from '@azit/types';
import { formatarWhatsapp, normalizarWhatsapp } from '@azit/utils';
import { whatsappService, ParametrosWhatsapp, ModeloWhatsapp } from '../services/whatsapp.service';
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

type Form = { ativo: boolean; numeros: string[]; modelos: Record<string, { nome: string; idioma: string }> };

function formDe(p: ParametrosWhatsapp): Form {
  return {
    ativo: p.ativo,
    numeros: p.numerosAutorizados,
    modelos: Object.fromEntries(p.modelos.map((m) => [m.momento, { nome: m.nome, idioma: m.idioma }])),
  };
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
      await whatsappService.salvarParametros({
        ativo: form.ativo,
        numerosAutorizados: form.numeros,
        modeloD2Nome: d2?.nome,
        modeloD2Idioma: d2?.idioma,
        modeloD0Nome: d0?.nome,
        modeloD0Idioma: d0?.idioma,
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
              Ligado, o sistema envia o lembrete 2 dias antes do vencimento e no dia do vencimento, todos os dias, das {p.janela.inicio}h às {p.janela.fim}h
              (horário de Brasília), com o link da Fatura Azit. Só recebe o titular com o lembrete ligado na ficha e com fatura em aberto.
              Desligado, nenhum lembrete é gerado. As respostas em Conversas não dependem desta chave.
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

      <Botao variante="primaria" className="self-start" carregando={ocupado} disabled={!mudou} onClick={() => void salvar()}>
        Salvar nova versão
      </Botao>
    </div>
  );
}
