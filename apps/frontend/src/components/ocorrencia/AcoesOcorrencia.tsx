import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { frotaService as svc, type Ocorrencia } from '../../services/frota.service';
import { Modal } from '../Modal';
import { Botao, type VarianteBotao } from '../Botao';
import { toast } from '../Toast';
import { mensagemErro } from '../../lib/permissoes';
import { reaisParaCentavos } from '../../lib/valor';
import { dataBR } from '../../lib/datas';

// Desfechos de uma ocorrência do veículo (doc 02 §25.3) — os MESMOS diálogos
// no quadro de Multas e pendências e na ficha do veículo (doc 02 §25.7).
// Valor digitado em formato brasileiro ("1.234,56") passa por reaisParaCentavos.

export type AcaoOcorrencia = 'repassar' | 'cliente-paga' | 'comprovante' | 'assumir' | 'recurso' | 'cancelar' | 'responsavel' | 'reabrir';

const ABERTAS = ['REGISTRADA', 'EM_RECURSO', 'AGUARDANDO_COMPROVANTE'];
export const ocorrenciaAberta = (o: Ocorrencia) => ABERTAS.includes(o.status);

const inputCls = 'w-full rounded-[10px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const centavosParaCampo = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Botões de desfecho que fazem sentido para esta ocorrência, na ordem de uso. */
export function acoesDaOcorrencia(o: Ocorrencia, podeOperar: boolean): { acao: AcaoOcorrencia; rotulo: string; variante: VarianteBotao }[] {
  if (!podeOperar) return [];
  if (!ocorrenciaAberta(o)) {
    // Repassada já é item de fatura — trata-se pela fatura, não reabre (regra do serviço).
    return o.status === 'REPASSADA' ? [] : [{ acao: 'reabrir', rotulo: 'Reabrir', variante: 'fantasma' }];
  }
  const lista: { acao: AcaoOcorrencia; rotulo: string; variante: VarianteBotao }[] = [];
  if (o.responsavel === 'CLIENTE' && o.contrato) lista.push({ acao: 'repassar', rotulo: 'Cobrar na próxima fatura', variante: 'primaria' });
  if (o.responsavel === 'CLIENTE' && o.status !== 'AGUARDANDO_COMPROVANTE') lista.push({ acao: 'cliente-paga', rotulo: 'Cliente paga direto', variante: 'secundaria' });
  if (o.status === 'AGUARDANDO_COMPROVANTE') lista.push({ acao: 'comprovante', rotulo: 'Registrar comprovante', variante: 'secundaria' });
  lista.push({ acao: 'assumir', rotulo: 'Azit assume', variante: 'secundaria' });
  if (o.status !== 'EM_RECURSO') lista.push({ acao: 'recurso', rotulo: 'Entrar com recurso', variante: 'secundaria' });
  lista.push({ acao: 'responsavel', rotulo: 'Trocar responsável', variante: 'fantasma' });
  lista.push({ acao: 'cancelar', rotulo: 'Cancelar', variante: 'perigo' });
  return lista;
}

const TITULO: Record<AcaoOcorrencia, string> = {
  repassar: 'Cobrar na fatura do cliente',
  'cliente-paga': 'Cliente paga direto ao órgão',
  comprovante: 'Registrar comprovante do cliente',
  assumir: 'Azit assume a ocorrência',
  recurso: 'Marcar em recurso',
  cancelar: 'Cancelar ocorrência',
  responsavel: 'Trocar o responsável',
  reabrir: 'Reabrir ocorrência',
};

export function ModalAcaoOcorrencia({ acao, o, onFechar, onFeito }: { acao: AcaoOcorrencia; o: Ocorrencia; onFechar: () => void; onFeito: () => void | Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const [campo, setCampo] = useState({
    valor: centavosParaCampo(o.valorComDesconto ?? o.valor),
    prazo: '',
    obs: '',
    motivo: '',
    justificativa: '',
    responsavel: (o.responsavel === 'CLIENTE' ? 'AZIT' : 'CLIENTE') as 'CLIENTE' | 'AZIT',
    arquivoNome: '',
    arquivoConteudo: '',
  });

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      toast.sucesso(ok);
      await onFeito();
      onFechar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function lerArquivo(file: File) {
    const leitor = new FileReader();
    leitor.onload = () => setCampo((c) => ({ ...c, arquivoNome: file.name, arquivoConteudo: String(leitor.result ?? '') }));
    leitor.readAsDataURL(file);
  }

  const isoDoCampo = (d: string) => (d ? new Date(d).toISOString() : undefined);

  function confirmar() {
    switch (acao) {
      case 'repassar':
        return rodar(async () => {
          const r = await svc.repassar(o.id, reaisParaCentavos(campo.valor));
          toast.sucesso(`Cobrado na fatura nº ${r.faturaNumero}, que vence em ${dataBR(r.vencimento)}.`);
        }, 'Repasse registrado.');
      case 'cliente-paga':
        return rodar(() => svc.clientePaga(o.id, { prazoComprovante: isoDoCampo(campo.prazo), observacao: campo.obs || undefined }), 'Registrado.');
      case 'comprovante':
        return rodar(
          () => svc.comprovante(o.id, {
            arquivo: campo.arquivoConteudo ? { nome: campo.arquivoNome, conteudo: campo.arquivoConteudo } : undefined,
            observacao: campo.obs || undefined,
          }),
          'Ocorrência quitada.',
        );
      case 'assumir':
        return rodar(() => svc.assumir(o.id, campo.obs || undefined), 'A Azit assumiu: virou custo do veículo.');
      case 'recurso':
        return rodar(() => svc.recurso(o.id, { prazo: isoDoCampo(campo.prazo), observacao: campo.obs || undefined }), 'Marcada em recurso.');
      case 'cancelar':
        return rodar(() => svc.cancelar(o.id, campo.motivo), 'Ocorrência cancelada.');
      case 'responsavel':
        return rodar(() => svc.definirResponsavel(o.id, campo.responsavel, campo.justificativa), 'Responsável alterado.');
      case 'reabrir':
        return rodar(() => svc.reabrir(o.id, campo.motivo), 'Ocorrência reaberta.');
    }
  }

  const desabilitado =
    ocupado ||
    (acao === 'cancelar' && !campo.motivo.trim()) ||
    (acao === 'responsavel' && campo.justificativa.trim().length < 10) ||
    (acao === 'repassar' && reaisParaCentavos(campo.valor) <= 0);

  return (
    <Modal open onClose={onFechar} title={TITULO[acao]}>
      <div className="flex flex-col gap-[10px] text-[12.5px]">
        {acao === 'repassar' && (
          <>
            <p style={{ color: 'var(--text-muted)' }}>
              O valor entra como item na <b>próxima fatura aberta</b> da conta, junto com as parcelas (cláusula 3.5).
              Se não for paga, segue para a régua de cobrança como qualquer fatura.
            </p>
            <label className="flex flex-col gap-[4px]">Valor a cobrar (R$)
              <input className={inputCls} style={inputStyle} inputMode="decimal" value={campo.valor} onChange={(e) => setCampo({ ...campo, valor: e.target.value })} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>= {formatCurrency(reaisParaCentavos(campo.valor))}</span>
            </label>
          </>
        )}
        {acao === 'cliente-paga' && (
          <>
            <p style={{ color: 'var(--text-muted)' }}>Nada vai para a fatura. Fica pendente até o comprovante chegar.</p>
            <label className="flex flex-col gap-[4px]">Prazo para o comprovante
              <input type="date" className={inputCls} style={inputStyle} value={campo.prazo} onChange={(e) => setCampo({ ...campo, prazo: e.target.value })} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Em branco = 7 dias.</span>
            </label>
          </>
        )}
        {acao === 'comprovante' && (
          <>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); }} />
            {campo.arquivoNome && <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{campo.arquivoNome}</span>}
          </>
        )}
        {acao === 'assumir' && <p style={{ color: 'var(--text-muted)' }}>O valor vira <b>custo do veículo</b> e não é cobrado do cliente.</p>}
        {acao === 'recurso' && (
          <label className="flex flex-col gap-[4px]">Prazo do recurso
            <input type="date" className={inputCls} style={inputStyle} value={campo.prazo} onChange={(e) => setCampo({ ...campo, prazo: e.target.value })} />
          </label>
        )}
        {acao === 'responsavel' && (
          <>
            <p style={{ color: 'var(--text-muted)' }}>
              O sistema definiu <b>{o.responsavel === 'CLIENTE' ? 'Cliente' : 'Azit'}</b> pela data do fato ({dataBR(o.dataFato)}). Para mudar, explique o motivo.
            </p>
            <select className={inputCls} style={inputStyle} value={campo.responsavel} onChange={(e) => setCampo({ ...campo, responsavel: e.target.value as 'CLIENTE' | 'AZIT' })}>
              <option value="CLIENTE">Cliente</option>
              <option value="AZIT">Azit</option>
            </select>
            <textarea rows={2} className={inputCls} style={inputStyle} value={campo.justificativa} onChange={(e) => setCampo({ ...campo, justificativa: e.target.value })} placeholder="Justificativa (mínimo 10 caracteres)" />
          </>
        )}
        {acao === 'reabrir' && <p style={{ color: 'var(--text-muted)' }}>A ocorrência volta para <b>Novas</b>, à espera de um desfecho.</p>}
        {acao === 'cancelar' || acao === 'reabrir' ? (
          <label className="flex flex-col gap-[4px]">{acao === 'cancelar' ? 'Motivo' : 'Motivo (opcional)'}
            <input className={inputCls} style={inputStyle} value={campo.motivo} onChange={(e) => setCampo({ ...campo, motivo: e.target.value })} />
          </label>
        ) : acao !== 'responsavel' ? (
          <label className="flex flex-col gap-[4px]">Observação
            <input className={inputCls} style={inputStyle} value={campo.obs} onChange={(e) => setCampo({ ...campo, obs: e.target.value })} placeholder={acao === 'cliente-paga' ? 'Ex.: combinado por telefone' : undefined} />
          </label>
        ) : null}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="secundaria" tamanho="sm" onClick={onFechar}>Fechar</Botao>
          <Botao variante={acao === 'cancelar' ? 'perigo' : 'primaria'} tamanho="sm" disabled={desabilitado} carregando={ocupado} onClick={() => void confirmar()}>
            {acao === 'repassar' ? 'Cobrar' : 'Confirmar'}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

export function ModalNovaOcorrencia({ placa, onFechar, onFeito }: { placa?: string | null; onFechar: () => void; onFeito: () => void | Promise<void> }) {
  const opcoes = useQuery({ queryKey: ['frota-opcoes'], queryFn: () => svc.opcoes() });
  const [ocupado, setOcupado] = useState(false);
  const [f, setF] = useState({ placa: placa ?? '', tipo: 'MULTA', orgao: '', numeroAuto: '', descricao: '', dataFato: '', dataVencimento: '', prazoIndicacao: '', valor: '' });
  const iso = (d: string) => (d ? new Date(d).toISOString() : undefined);

  async function registrar() {
    setOcupado(true);
    try {
      await svc.registrar({
        placa: f.placa,
        tipo: f.tipo,
        orgao: f.orgao || undefined,
        numeroAuto: f.numeroAuto || undefined,
        descricao: f.descricao || undefined,
        dataFato: new Date(f.dataFato).toISOString(),
        dataVencimento: iso(f.dataVencimento),
        prazoIndicacao: iso(f.prazoIndicacao),
        valor: f.valor ? reaisParaCentavos(f.valor) : 0,
      });
      toast.sucesso('Ocorrência registrada.');
      await onFeito();
      onFechar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title="Nova ocorrência" largura={560}>
      <div className="grid grid-cols-1 gap-[10px] text-[12.5px] sm:grid-cols-2">
        <label className="flex flex-col gap-[4px]">Placa *
          <input className={inputCls} style={inputStyle} value={f.placa} disabled={!!placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} />
        </label>
        <label className="flex flex-col gap-[4px]">Tipo *
          <select className={inputCls} style={inputStyle} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            {(opcoes.data?.tipos ?? []).map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[4px]">Data do fato *
          <input type="date" className={inputCls} style={inputStyle} value={f.dataFato} onChange={(e) => setF({ ...f, dataFato: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[4px]">Valor (R$)
          <input className={inputCls} style={inputStyle} inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="1.234,56" />
        </label>
        <label className="flex flex-col gap-[4px]">Número do auto
          <input className={inputCls} style={inputStyle} value={f.numeroAuto} onChange={(e) => setF({ ...f, numeroAuto: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[4px]">Órgão
          <input className={inputCls} style={inputStyle} value={f.orgao} onChange={(e) => setF({ ...f, orgao: e.target.value })} placeholder="Detran-ES, PRF…" />
        </label>
        <label className="flex flex-col gap-[4px]">Vencimento
          <input type="date" className={inputCls} style={inputStyle} value={f.dataVencimento} onChange={(e) => setF({ ...f, dataVencimento: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[4px]">Prazo de indicação
          <input type="date" className={inputCls} style={inputStyle} value={f.prazoIndicacao} onChange={(e) => setF({ ...f, prazoIndicacao: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[4px] sm:col-span-2">Descrição
          <input className={inputCls} style={inputStyle} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: excesso de velocidade até 20%" />
        </label>
        <div className="flex flex-wrap justify-end gap-[8px] sm:col-span-2">
          <Botao variante="secundaria" tamanho="sm" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primaria" tamanho="sm" disabled={!f.placa || !f.dataFato} carregando={ocupado} onClick={() => void registrar()}>Registrar</Botao>
        </div>
      </div>
    </Modal>
  );
}
