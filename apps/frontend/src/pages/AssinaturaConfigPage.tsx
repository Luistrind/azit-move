import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assinaturaConfigService, ParametrosAssinatura } from '../services/assinaturaConfig.service';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Configuração → Assinatura digital (doc 02 §21 F1.1): quem assina pela Azit
// (João Pedro), as duas testemunhas padrão (impressas no contrato E signatárias
// na ZapSign) e o envio automático do link por WhatsApp.
// Layout v2 (doc 03 §11): cartões com <Secao>, ações em <Botao>, só tokens.

const card = 'rounded-card p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
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
      <Secao titulo={titulo}>
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
      </Secao>
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

  if (!form) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
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
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Assinatura digital</h1>
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
        <Secao titulo="Envio do link">
          <label className="flex min-h-[30px] items-center gap-[8px] text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={form.envioAutomaticoWhatsapp} onChange={(e) => set({ envioAutomaticoWhatsapp: e.target.checked })} />
            Envio automático do link por WhatsApp (pela ZapSign)
          </label>
          <div className="mt-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Requer créditos de WhatsApp no plano ZapSign. Vale para signatários com telefone preenchido —
            os demais continuam recebendo o link pelo operador.
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Validade">
          <label className="flex flex-wrap items-center gap-[10px] text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Validade do contrato não efetivado
            <input
              value={String(form.validadeDias ?? 7)}
              onChange={(e) => set({ validadeDias: Math.max(1, parseInt(e.target.value.replace(/\D/g, '') || '7', 10)) })}
              className="h-[32px] w-[64px] rounded-[10px] px-[8px] text-right text-[13px] tabular-nums"
              style={inputStyle}
            />
            dias
          </label>
          <div className="mt-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Instrumento não assinado (ou entrada não paga) além desse prazo EXPIRA automaticamente:
            o contrato é cancelado, o veículo volta ao estoque e a proposta pode ser reformalizada.
            O cancelamento manual continua disponível no detalhe do contrato.
          </div>
        </Secao>
      </div>

      <Botao variante="primaria" className="self-start" carregando={ocupado} onClick={() => void salvar()}>Salvar parâmetros</Botao>
    </div>
  );
}
