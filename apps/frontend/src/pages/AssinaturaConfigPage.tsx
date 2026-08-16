import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assinaturaConfigService, ParametrosAssinatura } from '../services/assinaturaConfig.service';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';

// Configuração → Assinatura digital (doc 02 §21 F1.1): quem assina pela Azit
// (João Pedro), as duas testemunhas padrão (impressas no contrato E signatárias
// na ZapSign) e o envio automático do link por WhatsApp.

const card = 'rounded-[14px] p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] w-full rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const btnP = 'rounded-[8px] bg-[var(--navy)] px-[14px] py-[8px] text-[12px] font-bold text-white disabled:opacity-40';
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <label className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</label>
);

type Form = Omit<ParametrosAssinatura, 'id'>;

function BlocoPessoa({ titulo, sub, prefixo, form, set }: {
  titulo: string;
  sub: string;
  prefixo: 'azit' | 'testemunha1' | 'testemunha2';
  form: Form;
  set: (patch: Partial<Form>) => void;
}) {
  const nome = `${prefixo}Nome` as keyof Form;
  const cpf = `${prefixo}Cpf` as keyof Form;
  const zap = `${prefixo}Whatsapp` as keyof Form;
  return (
    <div className={card} style={cardStyle}>
      <div className="font-display text-[13px] font-bold">{titulo}</div>
      <div className="mb-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>{sub}</div>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
        <div className="flex flex-col gap-[4px]">
          <Lbl>Nome completo</Lbl>
          <input className={inputCls} style={inputStyle} value={form[nome] as string} onChange={(e) => set({ [nome]: e.target.value } as Partial<Form>)} />
        </div>
        <div className="flex flex-col gap-[4px]">
          <Lbl>CPF</Lbl>
          <input className={inputCls} style={inputStyle} value={form[cpf] as string} onChange={(e) => set({ [cpf]: e.target.value } as Partial<Form>)} placeholder="000.000.000-00" />
        </div>
        <div className="flex flex-col gap-[4px]">
          <Lbl>WhatsApp (DDD + número)</Lbl>
          <input className={inputCls} style={inputStyle} value={form[zap] as string} onChange={(e) => set({ [zap]: e.target.value } as Partial<Form>)} placeholder="27999999999" />
        </div>
      </div>
    </div>
  );
}

export function AssinaturaConfigPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assinatura-parametros'], queryFn: () => assinaturaConfigService.obter() });
  const [form, setForm] = useState<Form | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (q.data && !form) {
      const { id: _id, ...resto } = q.data;
      setForm(resto);
    }
  }, [q.data, form]);

  if (!form) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  async function salvar() {
    if (!form) return;
    setOcupado(true);
    try {
      await assinaturaConfigService.salvar(form);
      await qc.invalidateQueries({ queryKey: ['assinatura-parametros'] });
      toast.sucesso('Parâmetros de assinatura salvos.');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-col gap-[14px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Assinatura digital</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Signatários padrão de todo contrato enviado à ZapSign: os compradores assinam primeiro, depois as
          duas testemunhas (que também saem impressas no contrato) e por último quem assina pela Azit.
          Com WhatsApp preenchido e o envio automático ligado, a própria ZapSign dispara o link por WhatsApp;
          sem telefone, o operador compartilha o link manualmente pela tela da proposta.
        </p>
      </div>

      <BlocoPessoa titulo="Assina pela Azit" sub="Representante da Azit Comércio de Veículos LTDA no contrato (vendedora)." prefixo="azit" form={form} set={set} />
      <BlocoPessoa titulo="Testemunha 1" sub="Impressa na seção de testemunhas e signatária na ZapSign." prefixo="testemunha1" form={form} set={set} />
      <BlocoPessoa titulo="Testemunha 2" sub="Impressa na seção de testemunhas e signatária na ZapSign." prefixo="testemunha2" form={form} set={set} />

      <div className={card} style={cardStyle}>
        <label className="flex items-center gap-[8px] text-[12.5px] font-semibold">
          <input type="checkbox" checked={form.envioAutomaticoWhatsapp} onChange={(e) => set({ envioAutomaticoWhatsapp: e.target.checked })} />
          Envio automático do link por WhatsApp (pela ZapSign)
        </label>
        <div className="mt-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Requer créditos de WhatsApp no plano ZapSign. Vale para signatários com telefone preenchido —
          os demais continuam recebendo o link pelo operador.
        </div>
      </div>

      <button className={`${btnP} self-start`} disabled={ocupado} onClick={() => void salvar()}>Salvar parâmetros</button>
    </div>
  );
}
