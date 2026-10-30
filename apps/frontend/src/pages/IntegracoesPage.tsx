import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { integracoesService, StatusIntegracoes } from '../services/integracoes.service';
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
    </div>
  );
}
