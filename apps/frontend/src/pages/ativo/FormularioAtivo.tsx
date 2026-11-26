import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { ativoService, type Ativo, type CriarAtivoBody } from '../../services/ativo.service';
import { capitalService } from '../../services/capital.service';
import { simuladorService } from '../../services/simulador.service';
import { Modal } from '../../components/Modal';
import { Botao } from '../../components/Botao';
import { toast } from '../../components/Toast';
import { mensagemErro } from '../../lib/permissoes';
import { reaisParaCentavos, inteiroBR } from '../../lib/valor';

// Cadastro do veículo (novo ou edição) — um diálogo só, aberto pela lista da
// frota ("+ Novo veículo") e pela ficha ("Editar cadastro"). O STATUS não está
// aqui: muda sozinho com o contrato, a reserva e o sinistro (doc 02 §25.1).

const COMBUSTIVEIS = ['flex', 'gasolina', 'eletrico', 'diesel', 'hibrido'];
const ORIGENS = ['locadora', 'particular', 'concessionaria'];
const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };

type Form = Record<string, string>;
const VAZIO: Form = {
  estruturaJuridicaId: '', marca: '', modelo: '', anoFabricacao: '', anoModelo: '', cor: '', placa: '', chassi: '', renavam: '',
  varianteCatalogo: 'carro', combustivel: 'flex', origem: '', quilometragemEntrada: '', valorAquisicao: '', valorVenda: '', pacoteOfertaId: '', ofertaFixaId: '',
};
const reaisCampo = (c: number | null) => (c ? (c / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '');
const str = (v: string) => (v.trim() === '' ? undefined : v.trim());

function formDe(a: Ativo): Form {
  return {
    estruturaJuridicaId: a.estruturaJuridica?.id ?? '',
    marca: a.marca ?? '', modelo: a.modelo ?? '', anoFabricacao: a.anoFabricacao?.toString() ?? '', anoModelo: a.anoModelo?.toString() ?? '',
    cor: a.cor ?? '', placa: a.placa ?? '', chassi: a.chassi ?? '', renavam: a.renavam ?? '', varianteCatalogo: a.varianteCatalogo ?? 'carro',
    combustivel: a.combustivel ?? 'flex', origem: a.origem ?? '', quilometragemEntrada: a.quilometragemEntrada?.toLocaleString('pt-BR') ?? '',
    valorAquisicao: reaisCampo(a.valorAquisicao), valorVenda: reaisCampo(a.valorVenda), pacoteOfertaId: a.pacoteOfertaId ?? '', ofertaFixaId: a.ofertaFixaId ?? '',
  };
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[4px]">
      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}</span>
      {children}
    </label>
  );
}

export function FormularioAtivo({ ativo, onFechar, onSalvo }: { ativo?: Ativo | null; onFechar: () => void; onSalvo: (a: Ativo) => void | Promise<void> }) {
  const [form, setForm] = useState<Form>(ativo ? formDe(ativo) : VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const ofertas = useQuery({ queryKey: ['ofertas-fixas'], queryFn: () => simuladorService.ofertasFixas() });
  const estruturas = useQuery({ queryKey: ['estruturas'], queryFn: () => capitalService.estruturas() });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function salvar() {
    if (!form.estruturaJuridicaId) {
      toast.erro('Vincule a estrutura jurídica dona do veículo — todo veículo pertence a exatamente uma.');
      return;
    }
    const body: CriarAtivoBody = {
      estruturaJuridicaId: form.estruturaJuridicaId,
      descricao: `${form.marca} ${form.modelo} ${form.anoModelo}`.trim() || 'Veículo',
      marca: str(form.marca), modelo: str(form.modelo), anoFabricacao: inteiroBR(form.anoFabricacao), anoModelo: inteiroBR(form.anoModelo),
      cor: str(form.cor), placa: str(form.placa), chassi: str(form.chassi), varianteCatalogo: form.varianteCatalogo, renavam: str(form.renavam),
      combustivel: form.combustivel || undefined, origem: str(form.origem), quilometragemEntrada: inteiroBR(form.quilometragemEntrada),
      valorAquisicao: form.valorAquisicao ? reaisParaCentavos(form.valorAquisicao) : undefined,
      valorVenda: form.valorVenda ? reaisParaCentavos(form.valorVenda) : undefined,
      pacoteOfertaId: str(form.pacoteOfertaId), ofertaFixaId: form.ofertaFixaId || null,
    };
    setOcupado(true);
    try {
      const salvo = ativo ? await ativoService.atualizar(ativo.id, body) : await ativoService.criar(body);
      toast.sucesso(ativo ? 'Cadastro atualizado.' : 'Veículo cadastrado.');
      await onSalvo(salvo);
      onFechar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={ativo ? 'Editar cadastro do veículo' : 'Novo veículo'} largura={820}>
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Campo rotulo="Estrutura jurídica dona (obrigatória)">
            <select value={form.estruturaJuridicaId} onChange={set('estruturaJuridicaId')} className={inputCls} style={inStyle}>
              <option value="">Selecione a estrutura…</option>
              {estruturas.data?.filter((e) => e.ativo !== false).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </Campo>
          <Link to="/estruturas" className="text-[10.5px] font-semibold" style={{ color: 'var(--accent)' }}>Cadastrar ou gerenciar estruturas →</Link>
        </div>
        <Campo rotulo="Tipo de bem">
          <select value={form.varianteCatalogo} onChange={set('varianteCatalogo')} className={inputCls} style={inStyle}>
            <option value="carro">Carro</option>
            <option value="moto">Moto</option>
            <option value="outro">Outro</option>
          </select>
        </Campo>
        <Campo rotulo="Placa"><input value={form.placa} onChange={set('placa')} className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Marca"><input value={form.marca} onChange={set('marca')} className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Modelo"><input value={form.modelo} onChange={set('modelo')} className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Ano de fabricação"><input value={form.anoFabricacao} onChange={set('anoFabricacao')} inputMode="numeric" className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Ano modelo"><input value={form.anoModelo} onChange={set('anoModelo')} inputMode="numeric" className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Cor"><input value={form.cor} onChange={set('cor')} className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Combustível">
          <select value={form.combustivel} onChange={set('combustivel')} className={inputCls} style={inStyle}>
            {COMBUSTIVEIS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Chassi"><input value={form.chassi} onChange={set('chassi')} className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="RENAVAM"><input value={form.renavam} onChange={set('renavam')} className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Origem">
          <select value={form.origem} onChange={set('origem')} className={inputCls} style={inStyle}>
            <option value="">—</option>
            {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Km na entrada"><input value={form.quilometragemEntrada} onChange={set('quilometragemEntrada')} inputMode="numeric" className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Valor de aquisição (R$)"><input value={form.valorAquisicao} onChange={set('valorAquisicao')} inputMode="decimal" className={inputCls} style={inStyle} /></Campo>
        <Campo rotulo="Valor de venda (R$)"><input value={form.valorVenda} onChange={set('valorVenda')} inputMode="decimal" className={inputCls} style={inStyle} /></Campo>
        <div className="sm:col-span-2">
          <Campo rotulo="Oferta fixa (opcional)">
            <select value={form.ofertaFixaId} onChange={set('ofertaFixaId')} className={inputCls} style={inStyle}>
              <option value="">Sem oferta vinculada</option>
              {ofertas.data?.filter((o) => o.ativa).map((o) => (
                <option key={o.id} value={o.id}>{o.nome} · {formatCurrency(o.valorParcela)}/{o.frequencia}</option>
              ))}
            </select>
          </Campo>
          <Link to="/configuracoes/simulador" className="text-[10.5px] font-semibold" style={{ color: 'var(--accent)' }}>Cadastrar ou gerenciar ofertas fixas →</Link>
        </div>
      </div>
      {ativo ? (
        <p className="mt-[12px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          O status do veículo não se edita aqui: ele muda sozinho com o contrato, a reserva da lista de espera e o sinistro. A preparação para venda
          (Em preparação → Disponível) é feita na ficha do veículo.
        </p>
      ) : (
        <p className="mt-[12px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          O veículo novo entra como <b>Em preparação</b>, com o checklist de Configuração › Checklist de preparação (troca de óleo, rastreador…).
          Ele já pode ser simulado e proposto, com o alerta; fica Disponível e pode gerar contrato quando for marcado como pronto na ficha.
        </p>
      )}
      <div className="mt-[14px] flex flex-wrap justify-end gap-[8px]">
        <Botao variante="secundaria" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primaria" onClick={() => void salvar()} carregando={ocupado}>{ativo ? 'Salvar' : 'Cadastrar'}</Botao>
      </div>
    </Modal>
  );
}
