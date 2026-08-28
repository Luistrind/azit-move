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
} from '../services/catalogo.service';
import { usePodeRole, mensagemErro } from '../lib/permissoes';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';

// Catálogo de Produtos F1 (doc 02 §17): Produto → Variante → Versão, com herança
// visível (herdado × sobrescrito), ciclo de vida e histórico de versões.
// Produtos nascem em Rascunho — o simulador só consome o catálogo na F2.

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const btn = 'rounded-[8px] px-[12px] py-[7px] text-[12px] font-bold';
const btnP = `${btn} bg-[var(--navy)] text-white disabled:opacity-40`;
const btnS = `${btn} border border-[var(--border)]`;

const COR_CICLO: Record<string, { bg: string; fg: string }> = {
  RASCUNHO: { bg: '#f2f3f5', fg: '#5a6472' },
  ATIVO: { bg: '#e5f5ec', fg: '#1c7c4c' },
  SUSPENSO: { bg: '#fff3d6', fg: '#8a5a00' },
  ENCERRADO: { bg: '#fdecec', fg: '#a12622' },
};

function ChipCiclo({ status }: { status: string }) {
  const c = COR_CICLO[status] ?? COR_CICLO.RASCUNHO;
  return (
    <span className="rounded-full px-[10px] py-[2px] text-[11.5px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {NOME_CICLO[status] ?? status}
    </span>
  );
}

export function CatalogoPage() {
  const produtos = useQuery({ queryKey: ['catalogo'], queryFn: () => catalogoService.listar() });
  const [abertoId, setAbertoId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Catálogo de produtos</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Produto → Variante → Versão. Mudança de parâmetro cria versão nova (contratos ficam presos à
          versão contratada); só produto <b>Ativo</b> aparece para simulação e venda — o Catálogo é a
          fonte única de precificação do simulador, da proteção embutida e do crédito avulso.
        </p>
      </div>

      {produtos.isLoading ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (
        (produtos.data ?? []).map((p) => (
          <div key={p.id} className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={cardStyle}>
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <div>
                <div className="flex items-center gap-[8px]">
                  <span className="font-display text-[15px] font-bold">{p.nome}</span>
                  <ChipCiclo status={p.status} />
                  {p.contratacaoAvulsa && (
                    <span className="rounded-full px-[8px] py-[2px] text-[10.5px] font-bold" style={{ background: '#eef4ff', color: '#2a5aa8' }}
                      title='Aparece em "+ Contratar crédito" para cliente ativo (doc 02 §17)'>
                      Contratação avulsa
                    </span>
                  )}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {p.classificacao ? `${p.classificacao} · ` : ''}{p.finalidade ?? ''}
                  {p.variantes.length > 0 && ` · Variantes: ${p.variantes.map((v) => v.nome).join(', ')}`}
                  {` · ${p.totalVersoes} ${p.totalVersoes === 1 ? 'versão' : 'versões'}`}
                </div>
              </div>
              <div className="flex items-center gap-[8px]">
                <label className="flex items-center gap-[5px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}
                  title="Produto contratável avulso por cliente já ativo — alimenta o modal + Contratar crédito">
                  <input
                    type="checkbox"
                    checked={p.contratacaoAvulsa}
                    onChange={(e) => { void catalogoService.atualizarCadastral(p.id, { contratacaoAvulsa: e.target.checked }).then(() => produtos.refetch()); }}
                  />
                  Contratação avulsa
                </label>
                <button className={btnP} onClick={() => setAbertoId(abertoId === p.id ? null : p.id)}>
                  {abertoId === p.id ? 'Fechar' : 'Abrir produto'}
                </button>
              </div>
            </div>
            {abertoId === p.id && <DetalheProduto id={p.id} />}
          </div>
        ))
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

  return (
    <div className="flex flex-col gap-[12px] rounded-[12px] p-[14px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
      {/* Ciclo de vida */}
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
          <span style={{ color: 'var(--text-muted)' }}>Ciclo de vida:</span>
          {d.status === 'RASCUNHO' && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus('ATIVO')}>Ativar produto</button>}
          {d.status === 'ATIVO' && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus('SUSPENSO')}>Suspender vendas</button>}
          {d.status === 'SUSPENSO' && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus('ATIVO')}>Reativar</button>}
          {['ATIVO', 'SUSPENSO'].includes(d.status) && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus('ENCERRADO')}>Encerrar produto</button>}
          {d.status === 'RASCUNHO' && <span style={{ color: 'var(--text-muted)' }}>— em rascunho não aparece para simulação nem venda.</span>}
        </div>
      )}

      {/* Abas: parâmetros do produto / por variante / histórico */}
      <div className="flex flex-wrap gap-[6px]">
        <button
          className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold"
          style={aba === 'produto' ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', border: '1px solid var(--border)' }}
          onClick={() => setAba('produto')}
        >
          Parâmetros do produto
        </button>
        {d.variantes.map((v) => (
          <button
            key={v.id}
            className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold"
            style={aba === v.id ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', border: '1px solid var(--border)' }}
            onClick={() => setAba(v.id)}
          >
            {v.nome}
          </button>
        ))}
        <button
          className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold"
          style={aba === 'historico' ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', border: '1px solid var(--border)' }}
          onClick={() => setAba('historico')}
        >
          Histórico de versões
        </button>
      </div>

      {aba === 'produto' && (
        <TabelaParametros
          titulo={`Nível produto — ${d.versaoProduto ? `V${d.versaoProduto}` : 'sem versão'} (vale para todas as variantes)`}
          parametros={semParamsRemovidos(d.chave, d.parametrosProduto)}
          origem={() => 'produto'}
          podeEditar={podeEditar}
          onNovaVersao={() => setEditando({ varianteId: null, titulo: 'Nova versão — nível produto', parametros: comParamsPV(d.chave, semParamsRemovidos(d.chave, d.parametrosProduto)) })}
        />
      )}

      {varianteAtiva && (
        <TabelaParametros
          titulo={`Variante ${varianteAtiva.nome} — ${varianteAtiva.versao ? `V${varianteAtiva.versao}` : 'sem versão'} (efetivo = produto + sobrescritas da variante)`}
          parametros={semParamsRemovidos(d.chave, varianteAtiva.parametrosEfetivos)}
          origem={(chave) => (chave in varianteAtiva.parametros ? 'variante' : 'produto')}
          podeEditar={podeEditar}
          onNovaVersao={() => setEditando({ varianteId: varianteAtiva.id, titulo: `Nova versão — variante ${varianteAtiva.nome}`, parametros: semParamsRemovidos(d.chave, varianteAtiva.parametros) })}
        />
      )}

      {aba === 'historico' && (
        <div className="flex flex-col gap-[6px]">
          {d.versoes.map((v) => (
            <div key={v.id} className="rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <b>V{v.numero}</b> · nível {v.nivel} · vigente desde {new Date(v.vigenteDesde).toLocaleDateString('pt-BR')}
              {v.vigenteAte ? ` até ${new Date(v.vigenteAte).toLocaleDateString('pt-BR')}` : ' (vigente)'}
              {v.observacao && <div style={{ color: 'var(--text-muted)' }}>{v.observacao}</div>}
            </div>
          ))}
        </div>
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
  parametros,
  origem,
  podeEditar,
  onNovaVersao,
}: {
  titulo: string;
  parametros: Parametros;
  origem: (chave: string) => 'produto' | 'variante';
  podeEditar: boolean;
  onNovaVersao: () => void;
}) {
  const chaves = Object.keys(parametros);
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="text-[12.5px] font-bold">{titulo}</div>
        {podeEditar && (
          <button className={btnP} onClick={onNovaVersao}>Alterar parâmetros (nova versão)</button>
        )}
      </div>
      {chaves.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum parâmetro neste nível ainda.</div>
      ) : (
        <div className="overflow-x-auto rounded-[10px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                <th className="px-[12px] py-[8px] font-semibold">Parâmetro</th>
                <th className="px-[12px] py-[8px] font-semibold">Valor</th>
                <th className="px-[12px] py-[8px] font-semibold">Origem</th>
              </tr>
            </thead>
            <tbody>
              {chaves.map((chave) => (
                <tr key={chave} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="px-[12px] py-[7px]">{nomeParametro(chave)}</td>
                  <td className="px-[12px] py-[7px] font-semibold">{formatarParametro(chave, parametros[chave])}</td>
                  <td className="px-[12px] py-[7px]">
                    <span
                      className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold"
                      style={origem(chave) === 'variante' ? { background: '#eef4ff', color: '#1c4587' } : { background: '#f2f3f5', color: '#5a6472' }}
                    >
                      {origem(chave) === 'variante' ? 'Sobrescrito na variante' : 'Herdado do produto'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
        {Object.keys(valores).map((chave) => (
          <label key={chave} className="flex flex-col gap-[3px] text-[11.5px] font-semibold">
            {nomeParametro(chave)} {sufixo(chave)}
            <input
              className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[10px] py-[7px] text-[13px]"
              value={valores[chave]}
              onChange={(e) => setValores({ ...valores, [chave]: e.target.value })}
            />
          </label>
        ))}
        <label className="flex flex-col gap-[3px] text-[11.5px] font-semibold">
          Motivo da alteração
          <textarea
            className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[10px] py-[7px] text-[13px]"
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex.: reajuste da comissão recorrente aprovado na diretoria de agosto"
          />
        </label>
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} onClick={salvar}>Criar nova versão</button>
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
