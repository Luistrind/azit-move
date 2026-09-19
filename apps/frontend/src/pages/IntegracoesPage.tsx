import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { integracoesService, StatusIntegracoes } from '../services/integracoes.service';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';

// Central de integrações (decisão Luís 15/09): credenciais do Asaas e da
// ZapSign configuráveis SEM SSH e SEM redeploy — write-only (a tela nunca
// mostra o valor salvo, só "configurada · final ····"), banco > env,
// auditado. Troca sandbox → produção acontece aqui.

const card = 'rounded-card flex flex-col gap-[12px] p-[18px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[34px] rounded-[8px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const btnP = 'rounded-[8px] px-[14px] py-[8px] text-[12.5px] font-semibold';

function Ambiente({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-[6px]">
      {(['sandbox', 'producao'] as const).map((a) => (
        <button key={a} onClick={() => onChange(a)}
          className="rounded-[8px] px-[12px] py-[6px] text-[12px] font-semibold"
          style={valor === a
            ? { background: a === 'producao' ? '#1f9d5b' : 'var(--navy)', color: '#fff' }
            : { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' }}>
          {a === 'producao' ? 'Produção' : 'Sandbox'}
        </button>
      ))}
    </div>
  );
}

function CampoSegredo({ rotulo, placeholder, valor, onChange }: { rotulo: string; placeholder: string; valor: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-[4px] text-[12px]">
      <span className="font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}</span>
      <input type="password" autoComplete="new-password" value={valor} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className={inputCls} style={inputStyle} />
    </label>
  );
}

function UrlWebhook({ path }: { path: string }) {
  const url = `${import.meta.env.VITE_API_URL}${path}`;
  return (
    <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
      <span style={{ color: 'var(--text-label)' }}>URL do webhook:</span>
      <code className="break-all rounded-[6px] px-[8px] py-[3px]" style={{ background: 'var(--surface-input)' }}>{url}</code>
      <button className="font-semibold underline" onClick={() => { void navigator.clipboard.writeText(url).then(() => toast.sucesso('URL copiada.')); }}>copiar</button>
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
  // WhatsApp (Meta) — notificações do POP-COB-001 (doc 02 §23). Ids do número e
  // da conta não são segredo (exibidos); token/segredo/verificação são write-only.
  const [waPhone, setWaPhone] = useState('');
  const [waWaba, setWaWaba] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waSecret, setWaSecret] = useState('');
  const [waVerify, setWaVerify] = useState('');
  const [testeWa, setTesteWa] = useState<string | null>(null);

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
        ...(waPhone !== '' ? { whatsappPhoneNumberId: waPhone } : {}),
        ...(waWaba !== '' ? { whatsappWabaId: waWaba } : {}),
        ...(waToken !== '' ? { whatsappAccessToken: waToken } : {}),
        ...(waSecret !== '' ? { whatsappAppSecret: waSecret } : {}),
        ...(waVerify !== '' ? { whatsappVerifyToken: waVerify } : {}),
      });
      setAsaasApiKey(''); setAsaasSecret(''); setZsToken(''); setZsSecret('');
      setWaPhone(''); setWaWaba(''); setWaToken(''); setWaSecret(''); setWaVerify('');
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

  async function testarWa() {
    setOcupado(true);
    setTesteWa(null);
    try {
      const r = await integracoesService.testarWhatsapp();
      setTesteWa(`${r.ok ? '✓' : '✗'} ${r.mensagem}`);
    } catch (e) {
      setTesteWa(`✗ ${mensagemErro(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  const chip = (fonte: string, simulado: boolean, ambiente: string) => (
    <span className="flex gap-[6px]">
      <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold"
        style={ambiente === 'producao' ? { background: '#eafaf1', color: '#1f9d5b' } : { background: '#fef6e9', color: '#c98a0a' }}>
        {ambiente === 'producao' ? 'PRODUÇÃO' : 'SANDBOX'}
      </span>
      {simulado && <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: '#eef4ff', color: '#2456c7' }}>SIMULADO — sem credencial</span>}
      <span className="rounded-full px-[10px] py-[2px] text-[11px]" style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
        {fonte === 'banco' ? 'cadastrada no sistema' : 'herdada do servidor'}
      </span>
    </span>
  );

  if (!s) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>{status.isLoading ? 'Carregando…' : mensagemErro(status.error)}</div>;

  return (
    <div className="flex flex-col gap-[14px] p-[24px]">
      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Credenciais dos provedores externos, sem SSH e sem redeploy. As chaves já configuradas no
        servidor são <b>adotadas automaticamente</b> aqui — não é preciso procurá-las em lugar nenhum.
        Os valores são <b>write-only</b>: a tela mostra apenas o final de cada chave. Salvar aqui vale
        em segundos e tem precedência sobre o ambiente. Toda alteração é auditada.
      </p>

      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div className="font-display text-[14px] font-bold">Asaas — cobranças e pagamentos</div>
          {chip(s.asaas.fonte, s.asaas.simulado, s.asaas.ambiente)}
        </div>
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
        <div className="flex items-center gap-[10px]">
          <button className={btnP} style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} disabled={ocupado} onClick={() => void testar()}>
            Testar conexão
          </button>
          {teste && <span className="text-[12px]" style={{ color: teste.startsWith('✓') ? '#1f9d5b' : '#c0392b' }}>{teste}</span>}
        </div>
      </div>

      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div className="font-display text-[14px] font-bold">ZapSign — assinatura digital</div>
          {chip(s.zapsign.fonte, s.zapsign.simulado, s.zapsign.ambiente)}
        </div>
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

      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div className="font-display text-[14px] font-bold">WhatsApp (Meta) — notificações de cobrança</div>
          <span className="flex gap-[6px]">
            {s.whatsapp.simulado
              ? <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: '#eef4ff', color: '#2456c7' }}>SEM CREDENCIAL — simulado fora de produção</span>
              : <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: '#eafaf1', color: '#1f9d5b' }}>CONFIGURADO</span>}
            <span className="rounded-full px-[10px] py-[2px] text-[11px]" style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
              {s.whatsapp.fonte === 'banco' ? 'cadastrada no sistema' : 'herdada do servidor'}
            </span>
          </span>
        </div>
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          API oficial (WhatsApp Business Platform / Cloud API) do número dedicado às notificações formais do POP. Os dados
          estão no painel da Meta for Developers → seu app → WhatsApp → Configuração da API.
        </div>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Identificação do número de telefone</span>
            <input value={waPhone} onChange={(e) => setWaPhone(e.target.value.trim())} placeholder={s.whatsapp.phoneNumberId ?? 'ex.: 123456789012345'} className={inputCls} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Identificação da conta do WhatsApp Business</span>
            <input value={waWaba} onChange={(e) => setWaWaba(e.target.value.trim())} placeholder={s.whatsapp.wabaId ?? 'opcional'} className={inputCls} style={inputStyle} />
          </label>
          <CampoSegredo rotulo="Token de acesso permanente (usuário do sistema)"
            placeholder={s.whatsapp.accessTokenConfigurado ? `configurado · final ${s.whatsapp.accessTokenFinal}` : 'cole o token permanente'}
            valor={waToken} onChange={setWaToken} />
          <CampoSegredo rotulo="Chave secreta do app (valida o webhook)"
            placeholder={s.whatsapp.appSecretConfigurado ? `configurada · final ${s.whatsapp.appSecretFinal}` : 'Configurações do app → Básico → Chave secreta'}
            valor={waSecret} onChange={setWaSecret} />
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Token de verificação do webhook</span>
            <span className="flex gap-[6px]">
              <input value={waVerify} onChange={(e) => setWaVerify(e.target.value.trim())}
                placeholder={s.whatsapp.verifyTokenConfigurado ? `configurado · final ${s.whatsapp.verifyTokenFinal}` : 'gere e cole o mesmo no painel da Meta'}
                className={`${inputCls} flex-1`} style={inputStyle} />
              <button className="rounded-[8px] px-[10px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
                onClick={() => {
                  const v = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
                  setWaVerify(v);
                  void navigator.clipboard.writeText(v).then(() => toast.sucesso('Token gerado e copiado — cole no painel da Meta e salve aqui.'));
                }}>
                Gerar
              </button>
            </span>
          </label>
        </div>
        <UrlWebhook path={s.whatsapp.webhookPath} />
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          No painel da Meta (WhatsApp → Configuração), cadastre esta URL de retorno com o mesmo token de verificação e
          assine o campo <b>messages</b> — é por ele que chegam os comprovantes de entrega e leitura. O modelo da mensagem
          fica em <b>Configurações → Notificações de cobrança</b>.
        </div>
        <div className="flex items-center gap-[10px]">
          <button className={btnP} style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} disabled={ocupado} onClick={() => void testarWa()}>
            Testar conexão
          </button>
          {testeWa && <span className="text-[12px]" style={{ color: testeWa.startsWith('✓') ? '#1f9d5b' : '#c0392b' }}>{testeWa}</span>}
        </div>
      </div>

      <button className={`${btnP} self-start`} style={{ background: 'var(--navy)', color: '#fff', opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => void salvar()}>
        Salvar integrações
      </button>
    </div>
  );
}
