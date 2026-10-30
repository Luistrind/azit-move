import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { ativoService, CriarAtivoBody } from '../services/ativo.service';
import { capitalService } from '../services/capital.service';
import { simuladorService } from '../services/simulador.service';
import { StatusBadge } from '../components/StatusBadge';
import { ATIVO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos, inteiroBR } from '../lib/valor';
import { toast } from '../components/Toast';
import { instanteBR } from '../lib/datas';
import { Tabela } from '../components/Tabela';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Layout v2 (doc 03 §11): filtro de status em Chips, estoque em Tabela
// responsiva (celular = cartões), formulário em Secaos, botões do kit.

const DOC_TIPOS: { v: string; l: string }[] = [
  { v: 'crlv', l: 'CRLV / documento' },
  { v: 'nota_fiscal', l: 'Nota fiscal' },
  { v: 'laudo', l: 'Laudo' },
  { v: 'outro', l: 'Outro' },
];

const STATUS_LABEL: Record<string, string> = {
  disponivel: 'Disponível', em_contrato: 'Em contrato', transferido: 'Transferido', recuperado: 'Recuperado', sinistrado: 'Sinistrado',
};
const COMBUSTIVEIS = ['flex', 'gasolina', 'eletrico', 'diesel', 'hibrido'];
const ORIGENS = ['locadora', 'particular', 'concessionaria'];

const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</span>
);

type FormState = Record<string, string>;
const EMPTY: FormState = {
  estruturaJuridicaId: '',
  marca: '', modelo: '', anoFabricacao: '', anoModelo: '', cor: '', placa: '', chassi: '', renavam: '', varianteCatalogo: 'carro',
  combustivel: 'flex', origem: '', quilometragemEntrada: '', valorAquisicao: '', valorVenda: '', pacoteOfertaId: '', ofertaFixaId: '',
};

const reais = (v: string) => reaisParaCentavos(v);
const num = (v: string) => inteiroBR(v);
const str = (v: string) => (v.trim() === '' ? undefined : v.trim());

export function AtivoPage() {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_OPERACAO);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState('disponivel');

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  const [docTipo, setDocTipo] = useState('crlv');
  const [docBusy, setDocBusy] = useState(false);
  const ofertasFixas = useQuery({ queryKey: ['ofertas-fixas'], queryFn: () => simuladorService.ofertasFixas() });
  // Estruturas jurídicas: todo ativo nasce com a DONA definida (tag 04/08).
  const estruturas = useQuery({ queryKey: ['estruturas'], queryFn: () => capitalService.estruturas() });
  // Central de documentos (só ao editar um ativo existente).
  const documentos = useQuery({
    queryKey: ['ativo-documentos', editId],
    queryFn: () => ativoService.documentos(editId!),
    enabled: !!editId,
  });

  async function anexarDoc(file: File) {
    if (!editId) return;
    setDocBusy(true);
    try {
      const conteudo = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await ativoService.anexarDocumento(editId, { tipo: docTipo, nome: file.name, conteudo });
      await queryClient.invalidateQueries({ queryKey: ['ativo-documentos', editId] });
      toast.sucesso('Documento anexado.');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setDocBusy(false); }
  }

  async function removerDoc(id: string) {
    try {
      await ativoService.removerDocumento(id);
      await queryClient.invalidateQueries({ queryKey: ['ativo-documentos', editId] });
    } catch (e) { toast.erro(mensagemErro(e)); }
  }
  // Observação da frota (doc 02 §25.1): o operador anota na própria linha —
  // "na oficina", "aguardando documento". Salva ao sair do campo.
  async function salvarObservacao(id: string, texto: string, anterior: string | null) {
    if (texto.trim() === (anterior ?? '').trim()) return;
    try {
      await ativoService.atualizar(id, { observacao: texto.trim() || null });
      await queryClient.invalidateQueries({ queryKey: ['ativos'] });
      toast.sucesso('Observação salva.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  const ativos = useQuery({
    queryKey: ['ativos', filtroStatus, busca],
    queryFn: () => ativoService.listar({
      status: filtroStatus || undefined,
      placa: busca || undefined,
      chassi: busca || undefined,
      // Estoque é FROTA: o ativo sintético do crédito avulso (âncora de
      // recebível) não aparece aqui (feedback Luís 08/09).
      tipo: 'veiculo',
    }),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function novo() { setEditId(null); setForm(EMPTY); setStatus('disponivel'); setAberto(true); }

  async function editar(id: string) {
    setOcupado(true);
    try {
      const a = await ativoService.buscarPorId(id);
      setForm({
        estruturaJuridicaId: a.estruturaJuridica?.id ?? '',
        marca: a.marca ?? '', modelo: a.modelo ?? '', anoFabricacao: a.anoFabricacao?.toString() ?? '',
        anoModelo: a.anoModelo?.toString() ?? '', cor: a.cor ?? '', placa: a.placa ?? '', chassi: a.chassi ?? '', varianteCatalogo: a.varianteCatalogo ?? 'carro',
        renavam: a.renavam ?? '', combustivel: a.combustivel ?? 'flex', origem: a.origem ?? '',
        quilometragemEntrada: a.quilometragemEntrada?.toLocaleString('pt-BR') ?? '',
        valorAquisicao: a.valorAquisicao ? (a.valorAquisicao / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '',
        valorVenda: a.valorVenda ? (a.valorVenda / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '',
        pacoteOfertaId: a.pacoteOfertaId ?? '',
        ofertaFixaId: a.ofertaFixaId ?? '',
      });
      setStatus(a.status);
      setEditId(id);
      setAberto(true);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function salvar() {
    if (!form.estruturaJuridicaId) {
      toast.erro('Vincule a estrutura jurídica dona do ativo — todo ativo pertence a exatamente uma.');
      return;
    }
    const descricao = `${form.marca} ${form.modelo} ${form.anoModelo}`.trim() || 'Ativo';
    const body: CriarAtivoBody = {
      estruturaJuridicaId: form.estruturaJuridicaId,
      descricao,
      marca: str(form.marca), modelo: str(form.modelo), anoFabricacao: num(form.anoFabricacao),
      anoModelo: num(form.anoModelo), cor: str(form.cor), placa: str(form.placa), chassi: str(form.chassi), varianteCatalogo: form.varianteCatalogo,
      renavam: str(form.renavam), combustivel: form.combustivel || undefined, origem: str(form.origem),
      quilometragemEntrada: num(form.quilometragemEntrada),
      valorAquisicao: form.valorAquisicao ? reais(form.valorAquisicao) : undefined,
      valorVenda: form.valorVenda ? reais(form.valorVenda) : undefined,
      pacoteOfertaId: str(form.pacoteOfertaId),
      ofertaFixaId: form.ofertaFixaId || null,
    };
    setOcupado(true);
    try {
      // Aporte saiu do cadastro (doc 02 §19, 20/09): aqui se declara só a
      // estrutura jurídica dona — é ela que lastreia os recebíveis.
      if (editId) {
        await ativoService.atualizar(editId, { ...body, status });
      } else {
        await ativoService.criar(body);
      }
      setAberto(false);
      await queryClient.invalidateQueries({ queryKey: ['ativos'] });
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Barra de controles: busca + filtro de status em chips + ação principal */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar placa/chassi" aria-label="Buscar placa ou chassi" className={`${inputCls} min-w-0 flex-1 sm:max-w-[220px]`} style={inStyle} />
        {/* Regra "não clica, não exiba" (doc 03 §1): quitado/recuperado/sinistrado
            não têm produtor hoje (grupo B da varredura) — filtro que nada retorna
            some; voltam quando as transições existirem. */}
        <Chips
          itens={Object.entries(STATUS_LABEL)
            .filter(([k]) => k !== 'recuperado') // recuperado ainda sem produtor (retomada é processo futuro)
            .map(([k, v]) => ({ chave: k, rotulo: v }))}
          valor={filtroStatus || null}
          onChange={(k) => setFiltroStatus(k ?? '')}
          todos="Todos"
        />
        <div className="flex-1" />
        {podeEditar && (
          <Botao variante="primaria" onClick={novo}>+ Novo ativo</Botao>
        )}
      </div>

      {/* Formulário */}
      {aberto && podeEditar && (
        <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Secao titulo={editId ? 'Editar ativo' : 'Novo ativo'}>
            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-[4px]"><Lbl>Estrutura jurídica dona (obrigatória)</Lbl>
                <select value={form.estruturaJuridicaId} onChange={set('estruturaJuridicaId')} className={inputCls} style={inStyle}>
                  <option value="">Selecione a estrutura…</option>
                  {estruturas.data?.filter((e) => e.ativo !== false).map((e) => (
                    <option key={e.id} value={e.id}>{e.nome}</option>
                  ))}
                </select>
                <Link to="/estruturas" className="text-[10.5px] font-semibold" style={{ color: 'var(--accent)' }}>Cadastrar/gerenciar estruturas →</Link>
              </label>
              <label className="flex flex-col gap-[4px]"><Lbl>Marca</Lbl><input value={form.marca} onChange={set('marca')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Modelo</Lbl><input value={form.modelo} onChange={set('modelo')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Ano fab.</Lbl><input value={form.anoFabricacao} onChange={set('anoFabricacao')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Ano modelo</Lbl><input value={form.anoModelo} onChange={set('anoModelo')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Cor</Lbl><input value={form.cor} onChange={set('cor')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Placa</Lbl><input value={form.placa} onChange={set('placa')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Tipo de bem (variante do produto)</Lbl>
                <select value={form.varianteCatalogo} onChange={set('varianteCatalogo')} className={inputCls} style={inStyle}>
                  <option value="carro">Carro</option>
                  <option value="moto">Moto</option>
                  <option value="outro">Outro</option>
                </select></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Chassi</Lbl><input value={form.chassi} onChange={set('chassi')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>RENAVAM</Lbl><input value={form.renavam} onChange={set('renavam')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Combustível</Lbl>
                <select value={form.combustivel} onChange={set('combustivel')} className={inputCls} style={inStyle}>
                  {COMBUSTIVEIS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-[4px]"><Lbl>Origem</Lbl>
                <select value={form.origem} onChange={set('origem')} className={inputCls} style={inStyle}>
                  <option value="">—</option>
                  {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-[4px]"><Lbl>Km entrada</Lbl><input value={form.quilometragemEntrada} onChange={set('quilometragemEntrada')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Valor aquisição (R$)</Lbl><input value={form.valorAquisicao} onChange={set('valorAquisicao')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Valor de venda (R$)</Lbl><input value={form.valorVenda} onChange={set('valorVenda')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Oferta fixa (opcional)</Lbl>
                <select value={form.ofertaFixaId} onChange={set('ofertaFixaId')} className={inputCls} style={inStyle}>
                  <option value="">Sem oferta vinculada</option>
                  {ofertasFixas.data?.filter((o) => o.ativa).map((o) => (
                    <option key={o.id} value={o.id}>{o.nome} · {formatCurrency(o.valorParcela)}/{o.frequencia}</option>
                  ))}
                </select>
                <Link to="/configuracoes/simulador" className="text-[10.5px] font-semibold" style={{ color: 'var(--accent)' }}>Cadastrar/gerenciar ofertas fixas →</Link>
              </label>
              {editId && (
                <label className="flex flex-col gap-[4px]"><Lbl>Status</Lbl>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} style={inStyle}>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
            </div>
          </Secao>

          {/* Central de documentos do veículo (Doc 2 §4.4-A) — só ao editar */}
          {editId && (
            <div className="mt-[14px] border-t pt-[14px]" style={{ borderColor: 'var(--border)' }}>
              <Secao
                titulo="Documentos do veículo"
                acao={
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <select value={docTipo} onChange={(e) => setDocTipo(e.target.value)} className="h-[30px] rounded-[10px] px-[8px] text-[12px]" style={inStyle}>
                      {DOC_TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                    {/* É um <label> com o <input type=file> escondido — não cabe no Botao; mesmo desenho da primária. */}
                    <label className="inline-flex h-[30px] cursor-pointer items-center rounded-[10px] px-[11px] text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--navy)', opacity: docBusy ? 0.6 : 1 }}>
                      {docBusy ? 'Anexando…' : '+ Anexar arquivo'}
                      <input type="file" className="hidden" disabled={docBusy}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexarDoc(f); e.target.value = ''; }} />
                    </label>
                  </div>
                }
              >
                {documentos.data?.length === 0 ? (
                  <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum documento anexado.</div>
                ) : (
                  <div className="flex flex-col gap-[4px]">
                    {documentos.data?.map((d) => (
                      <div key={d.id} className="flex flex-wrap items-center justify-between gap-[6px] rounded-[10px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                        <span><b>{DOC_TIPOS.find((t) => t.v === d.tipo)?.l ?? d.tipo}</b> · {d.nome} <span style={{ color: 'var(--text-muted)' }}>· {instanteBR(d.anexadoEm)}</span></span>
                        <span className="flex items-center gap-[10px]">
                          <button type="button" onClick={() => ativoService.baixarDocumento(d.id, d.nome).catch((e) => toast.erro(mensagemErro(e)))} className="font-semibold" style={{ color: 'var(--accent)' }}>Baixar</button>
                          <button type="button" onClick={() => removerDoc(d.id)} className="text-[13px]" style={{ color: 'var(--danger-fg)' }} title="Remover">×</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-[6px] text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Dica: o preenchimento automático dos campos (placa, chassi…) a partir do documento entra numa próxima etapa (leitura por OCR).
                </div>
              </Secao>
            </div>
          )}

          <div className="mt-[14px] flex flex-wrap gap-[8px]">
            <Botao variante="primaria" onClick={salvar} carregando={ocupado}>
              {editId ? 'Salvar' : 'Cadastrar'}
            </Botao>
            <Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao>
          </div>
        </div>
      )}

      {/* Estoque. A observação é um <input> editado na própria linha; para ele
          funcionar também no cartão de celular, a linha não é clicável — o
          "Editar" vive nas ações da linha. */}
      <Tabela
        colunas={[
          { chave: 'ativo', titulo: 'Ativo', celular: 'titulo', render: (a) => a.descricao },
          { chave: 'placa', titulo: 'Placa', celular: 'subtitulo', classe: 'tabular-nums', render: (a) => a.placa ?? '—' },
          {
            chave: 'estrutura',
            titulo: 'Estrutura jurídica',
            celular: 'campo',
            render: (a) =>
              a.estruturaJuridica?.nome ?? (
                <span className="rounded-full px-[8px] py-[2px] text-[11px] font-bold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                  Sem estrutura — vincular
                </span>
              ),
          },
          { chave: 'venda', titulo: 'Valor de venda', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (a) => (a.valorVenda ? formatCurrency(a.valorVenda) : '—') },
          { chave: 'status', titulo: 'Status', celular: 'campo', render: (a) => <StatusBadge label={STATUS_LABEL[a.status] ?? a.status} colors={ATIVO_STATUS_COLORS} /> },
          {
            chave: 'cliente',
            titulo: 'Cliente',
            celular: 'campo',
            render: (a) =>
              a.cliente ? (
                <Link to={`/contratos/${a.cliente.contratoId}`} onClick={(e) => e.stopPropagation()} className="hover:underline" style={{ color: 'var(--text-primary)' }}>
                  {a.cliente.nome}
                  <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{a.cliente.contratoNumero}</span>
                </Link>
              ) : '—',
          },
          {
            chave: 'observacao',
            titulo: 'Observação',
            celular: 'campo',
            // Observação livre da operação — editada aqui mesmo (doc 02 §25.1).
            render: (a) =>
              podeEditar ? (
                <input
                  defaultValue={a.observacao ?? ''}
                  placeholder="—"
                  title="Anotação livre: na oficina, aguardando documento…"
                  onBlur={(e) => void salvarObservacao(a.id, e.target.value, a.observacao)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-full min-w-[140px] rounded-[10px] px-[8px] py-[5px] text-[12px]"
                  style={inStyle}
                />
              ) : (
                <span style={{ color: 'var(--text-body)' }}>{a.observacao ?? '—'}</span>
              ),
          },
        ]}
        linhas={ativos.data?.data ?? []}
        chave={(a) => a.id}
        carregando={ativos.isLoading}
        larguraMinima={960}
        vazio="Nenhum ativo."
        acoes={podeEditar ? (a) => <Botao variante="secundaria" tamanho="sm" onClick={() => editar(a.id)} disabled={ocupado}>Editar</Botao> : undefined}
      />
    </div>
  );
}
