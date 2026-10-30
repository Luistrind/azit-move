import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  catalogoService,
  Parametros,
  ValorParametro,
  nomeParametro,
  formatarParametro,
  NOME_CICLO,
  PARAMETROS_CONHECIDOS,
  type ProdutoCatalogoResumo,
  type ProdutoCatalogoDetalhe,
} from '../services/catalogo.service';
import { capitalService } from '../services/capital.service';
import { usePodeRole, mensagemErro } from '../lib/permissoes';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Chips } from '../components/Chips';
import { Secao } from '../components/Secao';
import { CATALOGO_CICLO_COLORS } from '../config/statusColors';
import { instanteBR } from '../lib/datas';

// Catálogo de Produtos F1 (doc 02 §17): Produto → Variante → Versão, com herança
// visível (herdado × sobrescrito), ciclo de vida e histórico de versões.
// Produtos nascem em Rascunho — o simulador só consome o catálogo na F2.
// Layout v2 (doc 03 §11): produtos em <Tabela> (clicar abre), detalhe do produto
// aberto em um <Bloco> abaixo da grade, abas em <Chips>, parâmetros em <Tabela>.

const inputCls = 'w-full rounded-[10px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

function ChipCiclo({ status }: { status: string }) {
  const c = CATALOGO_CICLO_COLORS[status] ?? CATALOGO_CICLO_COLORS.RASCUNHO;
  return (
    <span className="whitespace-nowrap rounded-full px-[10px] py-[2px] text-[11.5px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {NOME_CICLO[status] ?? status}
    </span>
  );
}

export function CatalogoPage() {
  const produtos = useQuery({ queryKey: ['catalogo'], queryFn: () => catalogoService.listar() });
  // Estrutura jurídica dona do produto (doc 02 §19, 12/09) — base do capital.
  const estruturas = useQuery({ queryKey: ['estruturas'], queryFn: () => capitalService.estruturas() });
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const lista = produtos.data ?? [];
  const aberto = lista.find((p) => p.id === abertoId) ?? null;
  // Os controles da linha (select/checkbox) não podem disparar o clique da linha.
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  const colunas: Coluna<ProdutoCatalogoResumo>[] = [
    {
      chave: 'nome',
      titulo: 'Produto',
      celular: 'titulo',
      render: (p) => (
        <span className="inline-flex flex-wrap items-center gap-[6px]">
          {p.nome}
          <ChipCiclo status={p.status} />
          {p.contratacaoAvulsa && (
            <span className="rounded-full px-[8px] py-[2px] text-[10.5px] font-bold" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}
              title='Aparece em "+ Contratar crédito" para cliente ativo (doc 02 §17)'>
              Contratação avulsa
            </span>
          )}
        </span>
      ),
    },
    { chave: 'finalidade', titulo: 'Classificação · finalidade', celular: 'subtitulo', render: (p) => [p.classificacao, p.finalidade].filter(Boolean).join(' · ') || '—' },
    { chave: 'variantes', titulo: 'Variantes', celular: 'campo', render: (p) => (p.variantes.length ? p.variantes.map((v) => v.nome).join(', ') : '—') },
    { chave: 'versoes', titulo: 'Versões', alinhar: 'center', classe: 'tabular-nums', celular: 'campo', render: (p) => p.totalVersoes },
    {
      chave: 'estrutura',
      titulo: 'Estrutura dona',
      celular: 'campo',
      render: (p) => (
        <select
          value={p.estruturaJuridica?.id ?? ''}
          onClick={parar}
          onChange={(e) => { void catalogoService.atualizarCadastral(p.id, { estruturaJuridicaId: e.target.value || null }).then(() => produtos.refetch()).catch((err) => { toast.erro(mensagemErro(err)); void produtos.refetch(); }); }}
          className="h-[30px] max-w-full rounded-[8px] px-[6px] text-[11.5px]"
          style={inputStyle}
          title="Estrutura jurídica DONA do produto (doc 02 §19) — base do capital e do split. Vazio = herda a estrutura do veículo (Compra Parcelada)."
        >
          <option value="">herda do veículo</option>
          {(estruturas.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>{e.nome}</option>
          ))}
        </select>
      ),
    },
    {
      chave: 'avulsa',
      titulo: 'Contratação avulsa',
      alinhar: 'center',
      celular: 'campo',
      render: (p) => (
        <input
          type="checkbox"
          checked={p.contratacaoAvulsa}
          onClick={parar}
          onChange={(e) => { void catalogoService.atualizarCadastral(p.id, { contratacaoAvulsa: e.target.checked }).then(() => produtos.refetch()).catch((err) => { toast.erro(mensagemErro(err)); void produtos.refetch(); }); }}
          title="Produto contratável avulso por cliente já ativo — alimenta o modal + Novo produto"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="m-0 max-w-[760px] text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Produto → Variante → Versão. Mudança de parâmetro cria versão nova (contratos ficam presos à
        versão contratada); só produto <b>Ativo</b> aparece para simulação e venda — o Catálogo é a
        fonte única de precificação do simulador, da proteção veicular e do crédito avulso.
      </p>

      <Tabela
        colunas={colunas}
        linhas={lista}
        chave={(p) => p.id}
        carregando={produtos.isLoading}
        vazio="Nenhum produto no catálogo."
        larguraMinima={860}
        onClick={(p) => setAbertoId(abertoId === p.id ? null : p.id)}
        acoes={(p) => (
          <Botao tamanho="sm" variante={abertoId === p.id ? 'secundaria' : 'primaria'} onClick={() => setAbertoId(abertoId === p.id ? null : p.id)}>
            {abertoId === p.id ? 'Fechar' : 'Abrir produto'}
          </Botao>
        )}
      />

      {aberto && (
        <Bloco titulo={aberto.nome} tag={<ChipCiclo status={aberto.status} />} id={`produto-${aberto.id}`}>
          <DetalheProduto id={aberto.id} />
        </Bloco>
      )}
    </div>
  );
}

// Homologação 04/08: parâmetros que DEIXARAM de pertencer à Compra Parcelada —
// a proteção embutida agora é calculada do produto Proteção Veicular (Essencial)
// e o desconto por antecipação pertence a ele. Some da tela e das versões novas;
// versões antigas que ainda carregam as chaves servem só de leitura congelada.
const PARAMS_REMOVIDOS_CP = ['protecaoMensal', 'taxaDescontoProtecaoAntecipacao'];
function semParamsRemovidos(chaveProduto: string, p: Parametros): Parametros {
  if (chaveProduto !== 'compra_parcelada') return p;
  const r: Parametros = {};
  for (const [k, v] of Object.entries(p)) if (!PARAMS_REMOVIDOS_CP.includes(k)) r[k] = v;
  return r;
}
// …e o desconto por antecipação passa a ser editável no produto PV (nasce 0).
function comParamsPV(chaveProduto: string, p: Parametros): Parametros {
  if (chaveProduto === 'compra_parcelada' || chaveProduto === 'reembolso_parcelado') {
    // Feedback 28/08: cada oferta padrão pode ser DESATIVADA (some do
    // atendimento) — os flags nascem na versão nova para o gestor ligar.
    return { oferta1Desativada: false, oferta2Desativada: false, oferta3Desativada: false, ...p };
  }
  if (chaveProduto !== 'protecao_veicular') return p;
  return { taxaDescontoProtecaoAntecipacao: 0, ...p };
}

type Versao = ProdutoCatalogoDetalhe['versoes'][number];

function DetalheProduto({ id }: { id: string }) {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(['ADMIN', 'DIRETOR']);
  const detalhe = useQuery({ queryKey: ['catalogo', id], queryFn: () => catalogoService.detalhe(id) });
  const [aba, setAba] = useState<string>('produto'); // 'produto' | varianteId | 'historico'
  const [editando, setEditando] = useState<null | { varianteId: string | null; titulo: string; parametros: Parametros }>(null);
  const [ocupado, setOcupado] = useState(false);

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: ['catalogo'] });
  }

  async function mudarStatus(status: string) {
    setOcupado(true);
    try {
      await catalogoService.mudarStatus(id, status);
      await recarregar();
      toast.sucesso(`Produto agora está ${NOME_CICLO[status].toLowerCase()}.`);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const d = detalhe.data;
  if (!d) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;

  const varianteAtiva = d.variantes.find((v) => v.id === aba) ?? null;

  const colunasVersao: Coluna<Versao>[] = [
    { chave: 'numero', titulo: 'Versão', celular: 'titulo', render: (v) => `V${v.numero}` },
    { chave: 'nivel', titulo: 'Nível', celular: 'subtitulo', render: (v) => v.nivel },
    { chave: 'vigencia', titulo: 'Vigência', celular: 'campo', render: (v) => `${instanteBR(v.vigenteDesde)}${v.vigenteAte ? ` até ${instanteBR(v.vigenteAte)}` : ' (vigente)'}` },
    { chave: 'obs', titulo: 'Observação', celular: 'campo', render: (v) => v.observacao || '—' },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      {/* Ciclo de vida */}
      {podeEditar && (
        <Secao titulo="Ciclo de vida" tag={d.status === 'RASCUNHO' ? 'em rascunho não aparece para simulação nem venda' : undefined}>
          <div className="flex flex-wrap items-center gap-[6px]">
            {d.status === 'RASCUNHO' && <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => mudarStatus('ATIVO')}>Ativar produto</Botao>}
            {d.status === 'ATIVO' && <Botao tamanho="sm" disabled={ocupado} onClick={() => mudarStatus('SUSPENSO')}>Suspender vendas</Botao>}
            {d.status === 'SUSPENSO' && <Botao tamanho="sm" variante="primaria" disabled={ocupado} onClick={() => mudarStatus('ATIVO')}>Reativar</Botao>}
            {['ATIVO', 'SUSPENSO'].includes(d.status) && <Botao tamanho="sm" variante="perigo" disabled={ocupado} onClick={() => mudarStatus('ENCERRADO')}>Encerrar produto</Botao>}
          </div>
        </Secao>
      )}

      {/* Abas: parâmetros do produto / por variante / histórico */}
      <Chips
        todos={null}
        tamanho="sm"
        valor={aba}
        onChange={(k) => { if (k) setAba(k); }}
        itens={[
          { chave: 'produto', rotulo: 'Parâmetros do produto' },
          ...d.variantes.map((v) => ({ chave: v.id, rotulo: v.nome })),
          { chave: 'historico', rotulo: 'Histórico de versões', contagem: d.versoes.length },
        ]}
      />

      {aba === 'produto' && (
        <TabelaParametros
          titulo={`Nível produto — ${d.versaoProduto ? `V${d.versaoProduto}` : 'sem versão'}`}
          nota="vale para todas as variantes"
          parametros={semParamsRemovidos(d.chave, d.parametrosProduto)}
          origem={() => 'produto'}
          podeEditar={podeEditar}
          onNovaVersao={() => setEditando({ varianteId: null, titulo: 'Nova versão — nível produto', parametros: comParamsPV(d.chave, semParamsRemovidos(d.chave, d.parametrosProduto)) })}
        />
      )}

      {varianteAtiva && (
        <TabelaParametros
          titulo={`Variante ${varianteAtiva.nome} — ${varianteAtiva.versao ? `V${varianteAtiva.versao}` : 'sem versão'}`}
          nota="efetivo = produto + sobrescritas da variante"
          parametros={semParamsRemovidos(d.chave, varianteAtiva.parametrosEfetivos)}
          origem={(chave) => (chave in varianteAtiva.parametros ? 'variante' : 'produto')}
          podeEditar={podeEditar}
          onNovaVersao={() => setEditando({ varianteId: varianteAtiva.id, titulo: `Nova versão — variante ${varianteAtiva.nome}`, parametros: semParamsRemovidos(d.chave, varianteAtiva.parametros) })}
        />
      )}

      {aba === 'historico' && (
        <Tabela colunas={colunasVersao} linhas={d.versoes} chave={(v) => v.id} vazio="Nenhuma versão ainda." larguraMinima={560} />
      )}

      {editando && (
        <EditorVersao
          titulo={editando.titulo}
          inicial={editando.parametros}
          fechar={() => setEditando(null)}
          confirmar={async (parametros, observacao) => {
            setOcupado(true);
            try {
              const r = await catalogoService.criarVersao(id, { varianteId: editando.varianteId, parametros, observacao });
              setEditando(null);
              await recarregar();
              toast.sucesso(`Versão ${r.numero} criada — a anterior foi encerrada.`);
            } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
          }}
        />
      )}
    </div>
  );
}

function TabelaParametros({
  titulo,
  nota,
  parametros,
  origem,
  podeEditar,
  onNovaVersao,
}: {
  titulo: string;
  nota?: string;
  parametros: Parametros;
  origem: (chave: string) => 'produto' | 'variante';
  podeEditar: boolean;
  onNovaVersao: () => void;
}) {
  const chaves = Object.keys(parametros);
  const colunas: Coluna<string>[] = [
    { chave: 'parametro', titulo: 'Parâmetro', celular: 'titulo', render: (chave) => nomeParametro(chave) },
    { chave: 'valor', titulo: 'Valor', celular: 'destaque', classe: 'font-semibold', render: (chave) => formatarParametro(chave, parametros[chave]) },
    {
      chave: 'origem',
      titulo: 'Origem',
      celular: 'campo',
      render: (chave) => (
        <span
          className="whitespace-nowrap rounded-full px-[8px] py-[1px] text-[10.5px] font-bold"
          style={origem(chave) === 'variante' ? { background: 'var(--info-bg)', color: 'var(--info-fg)' } : { background: 'var(--surface-muted)', color: 'var(--text-body)' }}
        >
          {origem(chave) === 'variante' ? 'Sobrescrito na variante' : 'Herdado do produto'}
        </span>
      ),
    },
  ];
  return (
    <Secao titulo={titulo} tag={nota} acao={podeEditar ? <Botao tamanho="sm" variante="primaria" onClick={onNovaVersao}>Alterar parâmetros (nova versão)</Botao> : undefined}>
      <Tabela colunas={colunas} linhas={chaves} chave={(c) => c} vazio="Nenhum parâmetro neste nível ainda." larguraMinima={520} />
    </Secao>
  );
}

// Editor de nova versão: valores editáveis no formato de exibição (R$ e % à
// brasileira); a conversão volta para centavos/fração ao salvar.
function EditorVersao({
  titulo,
  inicial,
  fechar,
  confirmar,
}: {
  titulo: string;
  inicial: Parametros;
  fechar: () => void;
  confirmar: (parametros: Parametros, observacao: string) => void | Promise<void>;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(inicial)) v[chave] = paraTexto(chave, valor);
    return v;
  });
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function salvar() {
    setErro(null);
    const parametros: Parametros = {};
    for (const [chave, texto] of Object.entries(valores)) {
      const convertido = deTexto(chave, texto, inicial[chave]);
      if (convertido === undefined) return setErro(`Valor inválido em "${nomeParametro(chave)}".`);
      parametros[chave] = convertido;
    }
    if (observacao.trim().length < 3) return setErro('Descreva o motivo da alteração — vai para o histórico e a auditoria.');
    void confirmar(parametros, observacao.trim());
  }

  return (
    <Modal open onClose={fechar} title={titulo}>
      <div className="flex max-h-[60vh] flex-col gap-[8px] overflow-y-auto pr-[4px]">
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Isso vai criar uma <b>versão nova</b> e encerrar a vigente. Contratos existentes continuam na
          versão com que foram contratados.
        </div>
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
          {Object.keys(valores).map((chave) => (
            <label key={chave} className="flex flex-col gap-[3px] text-[11.5px] font-semibold" style={{ color: 'var(--text-label)' }}>
              {nomeParametro(chave)} {sufixo(chave)}
              <input
                className={inputCls}
                style={inputStyle}
                value={valores[chave]}
                onChange={(e) => setValores({ ...valores, [chave]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-[3px] text-[11.5px] font-semibold" style={{ color: 'var(--text-label)' }}>
          Motivo da alteração
          <textarea
            className={inputCls}
            style={inputStyle}
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex.: reajuste da comissão recorrente aprovado na diretoria de agosto"
          />
        </label>
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primaria" onClick={salvar}>Criar nova versão</Botao>
        </div>
      </div>
    </Modal>
  );
}

function sufixo(chave: string): string {
  const tipo = PARAMETROS_CONHECIDOS[chave]?.tipo;
  if (tipo === 'dinheiro') return '(R$)';
  if (tipo === 'percentual') return '(%)';
  return '';
}

// Exibição editável: dinheiro em reais "3.990,00"; percentual em "1,7".
function paraTexto(chave: string, valor: ValorParametro): string {
  const tipo = PARAMETROS_CONHECIDOS[chave]?.tipo;
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  if (typeof valor !== 'number') return String(valor);
  if (tipo === 'dinheiro') return (valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  if (tipo === 'percentual') return (valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  return String(valor);
}

function deTexto(chave: string, texto: string, original: ValorParametro): ValorParametro | undefined {
  const tipo = PARAMETROS_CONHECIDOS[chave]?.tipo ?? (typeof original === 'boolean' ? 'booleano' : typeof original === 'number' ? 'inteiro' : 'texto');
  const t = texto.trim();
  if (tipo === 'booleano') {
    if (['sim', 's', 'true'].includes(t.toLowerCase())) return true;
    if (['não', 'nao', 'n', 'false'].includes(t.toLowerCase())) return false;
    return undefined;
  }
  if (tipo === 'texto') return t;
  const numero = Number(t.replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(numero)) return undefined;
  if (tipo === 'dinheiro') return Math.round(numero * 100);
  if (tipo === 'percentual') return numero / 100;
  return Math.round(numero);
}
