import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { integracoesService, StatusIntegracoes } from '../services/integracoes.service';
import { NOME_TRANSPORTE_EMAIL, ROTULO_ESTADO_ENVIO_EMAIL, motivoEmailLegivel } from '@azit/types';
import { ENVIO_EMAIL_COLORS } from '../config/statusColors';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela } from '../components/Tabela';
import { instanteHoraBR } from '../lib/datas';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Chips } from '../components/Chips';
import { Secao } from '../components/Secao';

// Central de integrações (decisão Luís 15/09): credenciais do Asaas e da
// ZapSign configuráveis SEM SSH e SEM redeploy — write-only (a tela nunca
// mostra o valor salvo, só "configurada · final ····"), banco > env,
// auditado. Troca sandbox → produção acontece aqui.
// Layout v2 (doc 03 §11): ambiente em <Chips>, cartões com <Secao>, <Botao>.

const card = 'rounded-card flex flex-col gap-[12px] p-[18px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const pilula = 'inline-flex items-center rounded-full px-[10px] py-[2px] text-[11px] font-bold';

function Ambiente({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <Chips
      todos={null}
      tamanho="sm"
      itens={[
        { chave: 'sandbox', rotulo: 'Sandbox' },
        { chave: 'producao', rotulo: 'Produção' },
      ]}
      valor={valor}
      onChange={(k) => { if (k) onChange(k); }}
    />
  );
}

function CampoSegredo({ rotulo, placeholder, valor, onChange }: { rotulo: string; placeholder: string; valor: string; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-[4px] text-[12px]">
      <span className="font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}</span>
      <input type="password" autoComplete="new-password" value={valor} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className={`${inputCls} w-full`} style={inputStyle} />
    </label>
  );
}

function UrlWebhook({ path }: { path: string }) {
  const url = `${import.meta.env.VITE_API_URL}${path}`;
  return (
    <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
      <span style={{ color: 'var(--text-label)' }}>URL do webhook:</span>
      <code className="max-w-full break-all rounded-[6px] px-[8px] py-[3px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>{url}</code>
      <Botao tamanho="sm" variante="fantasma" onClick={() => { void navigator.clipboard.writeText(url).then(() => toast.sucesso('URL copiada.')); }}>copiar</Botao>
    </div>
  );
}

export function IntegracoesPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['integracoes'], queryFn: () => integracoesService.status() });
  const s: StatusIntegracoes | undefined = status.data;

  const [ocupado, setOcupado] = useState(false);
  // Campos write-only: vazios por padrão; só o que for digitado é enviado.
  const [asaasAmbiente, setAsaasAmbiente] = useState<string | null>(null);
  const [asaasApiKey, setAsaasApiKey] = useState('');
  const [asaasSecret, setAsaasSecret] = useState('');
  const [zsAmbiente, setZsAmbiente] = useState<string | null>(null);
  const [zsToken, setZsToken] = useState('');
  const [zsSecret, setZsSecret] = useState('');
  const [teste, setTeste] = useState<string | null>(null);

  async function salvar() {
    setOcupado(true);
    try {
      await integracoesService.atualizar({
        ...(asaasAmbiente !== null ? { asaasAmbiente } : {}),
        ...(asaasApiKey !== '' ? { asaasApiKey } : {}),
        ...(asaasSecret !== '' ? { asaasWebhookSecret: asaasSecret } : {}),
        ...(zsAmbiente !== null ? { zapsignAmbiente: zsAmbiente } : {}),
        ...(zsToken !== '' ? { zapsignApiToken: zsToken } : {}),
        ...(zsSecret !== '' ? { zapsignWebhookSecret: zsSecret } : {}),
      });
      setAsaasApiKey(''); setAsaasSecret(''); setZsToken(''); setZsSecret('');
      setAsaasAmbiente(null); setZsAmbiente(null);
      toast.sucesso('Integrações salvas — valem em segundos, sem redeploy.');
      await qc.invalidateQueries({ queryKey: ['integracoes'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setTeste(null);
    try {
      const r = await integracoesService.testarAsaas();
      setTeste(`${r.ok ? '✓' : '✗'} ${r.mensagem}`);
    } catch (e) {
      setTeste(`✗ ${mensagemErro(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  const chip = (fonte: string, simulado: boolean, ambiente: string) => (
    <span className="flex flex-wrap gap-[6px]">
      <span className={pilula}
        style={ambiente === 'producao' ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
        {ambiente === 'producao' ? 'PRODUÇÃO' : 'SANDBOX'}
      </span>
      {simulado && <span className={pilula} style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>SIMULADO — sem credencial</span>}
      <span className={`${pilula} font-normal`} style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
        {fonte === 'banco' ? 'cadastrada no sistema' : 'herdada do servidor'}
      </span>
    </span>
  );

  if (!s) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{status.isLoading ? 'Carregando…' : mensagemErro(status.error)}</div>;

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Credenciais dos provedores externos, sem SSH e sem redeploy. As chaves já configuradas no
        servidor são <b>adotadas automaticamente</b> aqui — não é preciso procurá-las em lugar nenhum.
        Os valores são <b>write-only</b>: a tela mostra apenas o final de cada chave. Salvar aqui vale
        em segundos e tem precedência sobre o ambiente. Toda alteração é auditada.
      </p>

      <div className={card} style={cardStyle}>
        <Secao titulo="Asaas — cobranças e pagamentos" acao={chip(s.asaas.fonte, s.asaas.simulado, s.asaas.ambiente)}>
          <div className="flex flex-col gap-[12px]">
            <Ambiente valor={asaasAmbiente ?? s.asaas.ambiente} onChange={setAsaasAmbiente} />
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              <CampoSegredo rotulo="API key"
                placeholder={s.asaas.apiKeyConfigurada ? `configurada · final ${s.asaas.apiKeyFinal}` : 'cole a chave da conta Asaas'}
                valor={asaasApiKey} onChange={setAsaasApiKey} />
              <CampoSegredo rotulo="Segredo do webhook (token de autenticação)"
                placeholder={s.asaas.webhookSecretConfigurado ? `configurado · final ${s.asaas.webhookSecretFinal}` : 'defina um segredo forte'}
                valor={asaasSecret} onChange={setAsaasSecret} />
            </div>
            <UrlWebhook path={s.asaas.webhookPath} />
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              O mesmo segredo precisa estar no painel do Asaas (Integrações → Webhooks → "Token de
              autenticação"). Para migrar para produção: selecione <b>Produção</b>, cole a API key da conta
              de produção, salve e use <b>Testar conexão</b>.
            </div>
            <div className="flex flex-wrap items-center gap-[10px]">
              <Botao variante="secundaria" disabled={ocupado} onClick={() => void testar()}>
                Testar conexão
              </Botao>
              {teste && <span className="text-[12px]" style={{ color: teste.startsWith('✓') ? 'var(--ok-fg)' : 'var(--danger-fg)' }}>{teste}</span>}
            </div>
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="ZapSign — assinatura digital" acao={chip(s.zapsign.fonte, s.zapsign.simulado, s.zapsign.ambiente)}>
          <div className="flex flex-col gap-[12px]">
            <Ambiente valor={zsAmbiente ?? s.zapsign.ambiente} onChange={setZsAmbiente} />
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              <CampoSegredo rotulo="API token"
                placeholder={s.zapsign.apiTokenConfigurado ? `configurado · final ${s.zapsign.apiTokenFinal}` : 'cole o token da conta ZapSign'}
                valor={zsToken} onChange={setZsToken} />
              <CampoSegredo rotulo="Segredo do webhook (header x-azit-webhook-secret)"
                placeholder={s.zapsign.webhookSecretConfigurado ? `configurado · final ${s.zapsign.webhookSecretFinal}` : 'defina um segredo forte'}
                valor={zsSecret} onChange={setZsSecret} />
            </div>
            <UrlWebhook path={s.zapsign.webhookPath} />
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Sem token, o provedor fica em modo simulado (o botão de assinatura mock continua valendo em dev).
            </div>
          </div>
        </Secao>
      </div>

      <Botao variante="primaria" className="self-start" carregando={ocupado} onClick={() => void salvar()}>
        Salvar integrações
      </Botao>

      {/* Entrar com Google (doc 06 v1.1 §2.2): só informa — o client id é público e vem do
          ambiente do servidor (stack.env), não é editável aqui. Sem ele o botão não aparece no login. */}
      <div className={card} style={cardStyle}>
        <Secao
          titulo="Google — entrada no sistema (login)"
          acao={
            <span className="flex flex-wrap gap-[6px]">
              <span className={pilula}
                style={s.google.configurado ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                {s.google.configurado ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}
              </span>
              <span className={`${pilula} font-normal`} style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
                variável do servidor
              </span>
            </span>
          }
        >
          <div className="flex flex-col gap-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <div>
              Client id do cliente OAuth "Azit Hub Web":{' '}
              <code className="rounded-[6px] px-[6px] py-[2px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                {s.google.clientIdInicio ?? 'ausente'}
              </code>
              {' '}(variável <code>GOOGLE_CLIENT_ID</code> do backend). {s.google.configurado
                ? 'O botão "Entrar com Google" está ativo na tela de login.'
                : 'Sem ela o botão "Entrar com Google" não aparece e só a senha de reserva entra. Defina no stack.env do servidor e reinicie o backend.'}
            </div>
            <div>
              Quem entra: contas do Workspace (azit.com.br / azitmove.com.br) que existam em Usuários e permissões.
              Mudança de domínio ou origem é feita no{' '}
              <a href={s.google.console} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--info-fg)' }}>
                console do Google Cloud (projeto azit-hub)
              </a>.
            </div>
          </div>
        </Secao>
      </div>

      <CardEmail />
    </div>
  );
}

// E-mail (Gmail do Workspace — doc 06 v1.1 §12.4): só informa. Remetente e
// credencial vêm do ambiente do servidor (stack.env); a credencial nunca chega
// aqui. Lista os últimos envios/falhas da fila `email` (alertas de aprovação e,
// depois, Fatura Azit).
function CardEmail() {
  const status = useQuery({ queryKey: ['integracoes-email'], queryFn: () => integracoesService.statusEmail(), refetchInterval: 30_000 });
  const e = status.data;
  return (
    <div className={card} style={cardStyle}>
      <Secao
        titulo="E-mail (Gmail do Workspace)"
        acao={
          e ? (
            <span className="flex flex-wrap gap-[6px]">
              <span className={pilula}
                style={e.configurado ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                {e.configurado ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}
              </span>
              <span className={`${pilula} font-normal`} style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
                variáveis do servidor
              </span>
            </span>
          ) : null
        }
      >
        <div className="flex flex-col gap-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {status.isError ? (
            <div>{mensagemErro(status.error)}</div>
          ) : (
            <>
              <div>
                Transporte ativo:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{e ? (NOME_TRANSPORTE_EMAIL[e.transporte] ?? e.transporte) : '…'}</strong>
                {e?.descricao ? <span> ({e.descricao})</span> : null}
                {' '}· remetente:{' '}
                <code className="rounded-[6px] px-[6px] py-[2px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                  {e?.remetente ?? 'não definido'}
                </code>
                . {e?.configurado
                  ? 'Os alertas de aprovação dirigidos a um usuário saem por aqui.'
                  : 'Com EMAIL_TRANSPORTE=nenhum (ou sem EMAIL_REMETENTE) a fila registra "não configurado" e segue — o sino continua funcionando.'}
                {' '}O caminho escolhido é o relay SMTP do Workspace (sem senha; o IP do servidor é liberado no{' '}
                {e ? (
                  <a href={e.console} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--info-fg)' }}>Admin do Workspace › Gmail › Roteamento</a>
                ) : 'Admin do Workspace'}
                ); a API do Gmail com conta de serviço fica como alternativa. Variáveis do stack.env e passo a passo em deploy/AMBIENTES.md §1.7.
              </div>
              <div>
                O e-mail nunca leva dado pessoal do cliente (só operação, valor, solicitante, data e link). Cada usuário liga ou
                desliga os próprios alertas em "Minha conta".
              </div>
              <Secao titulo="Últimos envios da fila" tag="5 mais recentes · atualiza a cada 30 s">
                <Tabela
                  colunas={[
                    { chave: 'em', titulo: 'Quando', render: (u) => instanteHoraBR(u.em), celular: 'titulo', classe: 'tabular-nums' },
                    { chave: 'estado', titulo: 'Estado', celular: 'destaque', render: (u) => <StatusBadge label={ROTULO_ESTADO_ENVIO_EMAIL[u.estado]} colors={ENVIO_EMAIL_COLORS} /> },
                    { chave: 'para', titulo: 'Para', render: (u) => u.para, celular: 'subtitulo' },
                    { chave: 'assunto', titulo: 'Assunto', render: (u) => u.assunto },
                    { chave: 'motivo', titulo: 'Motivo / tentativas', render: (u) => `${u.motivo ? motivoEmailLegivel(u.motivo) : ''}${u.tentativas > 1 ? ` (${u.tentativas} tentativas)` : ''}` || '—' },
                  ]}
                  linhas={e?.ultimos ?? []}
                  chave={(u) => u.id}
                  carregando={status.isLoading}
                  larguraMinima={720}
                  vazio="Nenhum e-mail passou pela fila ainda."
                />
              </Secao>
            </>
          )}
        </div>
      </Secao>
    </div>
  );
}
