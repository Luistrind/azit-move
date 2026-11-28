import { useState } from 'react';
import { formatarWhatsapp, normalizarWhatsapp } from '@azit/utils';
import { titularService, type AtualizarTitularBody, type Titular } from '../services/titular.service';
import { mensagemErro } from '../lib/permissoes';
import { Modal } from './Modal';
import { Botao } from './Botao';
import { toast } from './Toast';

// Edição do cadastro VIVO do titular (ficha e lista de titulares, 27/11): vale
// daqui para frente — lembretes, Conversas e cobranças novas leem o cadastro na
// hora; contrato assinado é snapshot e não muda. Nome, e-mail e WhatsApp também
// vão para o cliente no Asaas (o backend avisa se o Asaas recusar).

const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };

type Campo = keyof AtualizarTitularBody;
const CAMPOS: { chave: Campo; rotulo: string; largo?: boolean; ajuda?: string }[] = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'whatsapp', rotulo: 'WhatsApp', ajuda: 'Com DDD. É para onde vão os lembretes e as Conversas.' },
  { chave: 'email', rotulo: 'E-mail' },
  { chave: 'rg', rotulo: 'RG' },
  { chave: 'estadoCivil', rotulo: 'Estado civil' },
  { chave: 'profissao', rotulo: 'Profissão' },
  { chave: 'endereco', rotulo: 'Endereço', largo: true },
  { chave: 'bairro', rotulo: 'Bairro' },
  { chave: 'cidade', rotulo: 'Cidade' },
  { chave: 'estado', rotulo: 'UF' },
  { chave: 'cep', rotulo: 'CEP' },
];

export function FormularioTitular({ titular, onFechar, onSalvo }: { titular: Titular; onFechar: () => void; onSalvo: () => void | Promise<void> }) {
  const inicial = Object.fromEntries(CAMPOS.map((c) => [c.chave, (titular[c.chave as keyof Titular] as string | null) ?? ''])) as Record<Campo, string>;
  const [form, setForm] = useState<Record<Campo, string>>(inicial);
  const [ocupado, setOcupado] = useState(false);
  const whatsappOk = !!normalizarWhatsapp(form.whatsapp);

  async function salvar() {
    if (!form.nome.trim()) return toast.erro('Informe o nome.');
    if (!whatsappOk) return toast.erro('WhatsApp inválido: informe DDD + número.');
    // Só o que mudou; campo opcional apagado vai como null (limpa o dado).
    const body: AtualizarTitularBody = {};
    for (const c of CAMPOS) {
      const novo = form[c.chave].trim();
      if (novo === inicial[c.chave].trim()) continue;
      (body as Record<string, string | null>)[c.chave] = novo === '' && c.chave !== 'nome' && c.chave !== 'whatsapp' ? null : novo;
    }
    if (!Object.keys(body).length) return onFechar();
    setOcupado(true);
    try {
      const r = await titularService.atualizar(titular.id, body);
      if (r.asaas?.situacao === 'falhou') toast.info(`Cadastro salvo no sistema, mas o Asaas não aceitou o contato novo: ${r.asaas.motivo}`);
      else toast.sucesso(r.asaas?.situacao === 'atualizado' ? 'Cadastro salvo — também atualizado no Asaas.' : 'Cadastro salvo.');
      await onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={`Editar cadastro · ${titular.nome}`} largura={640}>
      <div className="flex flex-col gap-[14px]">
        <div className="rounded-[10px] p-[10px] text-[11.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
          Muda o <b>cadastro vivo</b>, usado daqui para frente (lembretes, Conversas, cobranças novas). Contratos já assinados ficam como foram
          assinados. Nome, e-mail e WhatsApp também são atualizados no cliente do Asaas.
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          {CAMPOS.map((c) => (
            <label key={c.chave} className={`flex min-w-0 flex-col gap-[4px] ${c.largo ? 'sm:col-span-2' : ''}`}>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{c.rotulo}</span>
              <input
                value={form[c.chave]}
                onChange={(e) => setForm((f) => ({ ...f, [c.chave]: e.target.value }))}
                inputMode={c.chave === 'whatsapp' || c.chave === 'cep' ? 'tel' : undefined}
                aria-invalid={c.chave === 'whatsapp' && !whatsappOk}
                className={inputCls}
                style={c.chave === 'whatsapp' && !whatsappOk ? { ...inStyle, borderColor: 'var(--danger-fg)' } : inStyle}
              />
              {c.chave === 'whatsapp' ? (
                <span className="text-[11px]" style={{ color: whatsappOk ? 'var(--text-muted)' : 'var(--danger-fg)' }}>
                  {whatsappOk ? `Vai para ${formatarWhatsapp(normalizarWhatsapp(form.whatsapp)!)}. ${c.ajuda}` : 'Número inválido: informe DDD + número.'}
                </span>
              ) : null}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primaria" onClick={() => void salvar()} carregando={ocupado}>Salvar cadastro</Botao>
        </div>
      </div>
    </Modal>
  );
}
