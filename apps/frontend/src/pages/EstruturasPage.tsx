import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  capitalService,
  EstruturaJuridica,
  InvestidorEstrutura,
  NOME_TIPO_ESTRUTURA,
} from '../services/capital.service';
import { titularService } from '../services/titular.service';
import { ativoService } from '../services/ativo.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro } from '../lib/permissoes';
import { hojeBrasilISO } from '../lib/datas';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Secao } from '../components/Secao';

// Capital e investimento (doc 02 §15, reunião 18/07): estrutura jurídica (SPE/fundo,
// por rodada) é a dona do capital; investidor pessoa física nunca é dono direto do ativo.
// Layout v2 (doc 03 §11): estruturas em <Tabela> (clicar abre), painel da estrutura
// aberta em <Bloco> abaixo da grade com <Secao>s; formulários empilham no celular.

const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const inputStyleClaro = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

function reais(centavos: number | null): string {
  if (centavos == null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function EstruturasPage() {
  const queryClient = useQueryClient();
  const estruturas = useQuery({ queryKey: ['estruturas'], queryFn: () => capitalService.estruturas() });
  const [criando, setCriando] = useState(false);
  const [abertaId, setAbertaId] = useState<string | null>(null);

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ['estruturas'] });
  }

  const lista = estruturas.data ?? [];
  const aberta = lista.find((e) => e.id === abertaId) ?? null;

  const colunas: Coluna<EstruturaJuridica>[] = [
    { chave: 'nome', titulo: 'Estrutura', celular: 'titulo', render: (e) => e.nome },
    {
      chave: 'tipo',
      titulo: 'Tipo · rodada · CNPJ',
      celular: 'subtitulo',
      render: (e) => `${NOME_TIPO_ESTRUTURA[e.tipo] ?? e.tipo}${e.rodada ? ` · ${e.rodada}` : ''}${e.cnpj ? ` · CNPJ ${e.cnpj}` : ' · CNPJ a constituir'}`,
    },
    { chave: 'investidores', titulo: 'Investidores', alinhar: 'center', classe: 'tabular-nums', celular: 'campo', render: (e) => e.investidores.length },
    { chave: 'ativos', titulo: 'Ativos', alinhar: 'center', classe: 'tabular-nums', celular: 'campo', render: (e) => e.ativos.length },
    { chave: 'aportado', titulo: 'Total aportado', alinhar: 'right', classe: 'tabular-nums', celular: 'destaque', render: (e) => reais(e.totalAportado) },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="m-0 max-w-[720px] text-[13px]" style={{ color: 'var(--text-muted)' }}>
          A estrutura (sociedade de propósito específico ou fundo, por rodada de captação) é a dona do
          capital. Investidores aportam na estrutura; a estrutura financia os ativos.
        </p>
        <Botao variante={criando ? 'secundaria' : 'primaria'} onClick={() => setCriando((v) => !v)}>
          {criando ? 'Cancelar' : '+ Nova estrutura'}
        </Botao>
      </div>

      {criando && (
        <FormNovaEstrutura
          onCriada={async () => {
            setCriando(false);
            await recarregar();
          }}
        />
      )}

      <Tabela
        colunas={colunas}
        linhas={lista}
        chave={(e) => e.id}
        carregando={estruturas.isLoading}
        vazio="Nenhuma estrutura cadastrada. Crie a primeira para começar a registrar aportes."
        larguraMinima={720}
        onClick={(e) => setAbertaId(abertaId === e.id ? null : e.id)}
        acoes={(e) => (
          <Botao tamanho="sm" variante={abertaId === e.id ? 'secundaria' : 'primaria'} onClick={() => setAbertaId(abertaId === e.id ? null : e.id)}>
            {abertaId === e.id ? 'Fechar' : 'Gerenciar'}
          </Botao>
        )}
      />

      {aberta && (
        <Bloco titulo={aberta.nome} tag={`${NOME_TIPO_ESTRUTURA[aberta.tipo] ?? aberta.tipo} · ${reais(aberta.totalAportado)} aportados`}>
          <PainelEstrutura estrutura={aberta} onMudou={recarregar} />
        </Bloco>
      )}
    </div>
  );
}

function FormNovaEstrutura({ onCriada }: { onCriada: () => void }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('SPE');
  const [cnpj, setCnpj] = useState('');
  const [rodada, setRodada] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setErro(null);
    if (nome.trim().length < 2) return setErro('Informe o nome da estrutura.');
    try {
      await capitalService.criarEstrutura({
        nome: nome.trim(),
        tipo,
        cnpj: cnpj.trim() || undefined,
        rodada: rodada.trim() || undefined,
      });
      onCriada();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  return (
    <Bloco titulo="Nova estrutura jurídica">
      <div className="grid grid-cols-1 items-end gap-[10px] sm:grid-cols-2 lg:grid-cols-5">
        <Campo rotulo="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: SPE Azit Rodada 2" className={inputCls} style={inputStyle} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls} style={inputStyle}>
            {Object.entries(NOME_TIPO_ESTRUTURA).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="CNPJ (se já constituída)">
          <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} className={inputCls} style={inputStyle} />
        </Campo>
        <Campo rotulo="Rodada de captação">
          <input value={rodada} onChange={(e) => setRodada(e.target.value)} placeholder="ex.: Rodada 2 — 2026" className={inputCls} style={inputStyle} />
        </Campo>
        <Botao variante="primaria" onClick={criar}>Criar estrutura</Botao>
      </div>
      {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
    </Bloco>
  );
}

function PainelEstrutura({ estrutura, onMudou }: { estrutura: EstruturaJuridica; onMudou: () => Promise<void> }) {
  const [buscaInvestidor, setBuscaInvestidor] = useState('');
  const [valorAporte, setValorAporte] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [buscaAtivo, setBuscaAtivo] = useState('');
  // Cadastro de pessoa investidora direto na estrutura (homologação 04/08 —
  // "não achei onde cadastrar o investidor"): cria o titular e já vincula.
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoDoc, setNovoDoc] = useState('');
  const [novoZap, setNovoZap] = useState('');
  const [criando, setCriando] = useState(false);

  const candidatos = useQuery({
    queryKey: ['titulares-busca-estrutura', buscaInvestidor],
    queryFn: () => titularService.listar({ nome: buscaInvestidor }),
    enabled: buscaInvestidor.trim().length >= 3,
  });
  const ativos = useQuery({
    queryKey: ['ativos-busca-estrutura', buscaAtivo],
    queryFn: () => ativoService.listar({ placa: buscaAtivo || undefined }),
    enabled: buscaAtivo.trim().length >= 3,
  });

  async function vincular(titularId: string) {
    setMsg(null);
    try {
      await capitalService.vincularInvestidor(estrutura.id, {
        titularId,
        valorAportado: valorAporte.trim() ? reaisParaCentavos(valorAporte) : undefined,
        dataAporte: hojeBrasilISO(),
      });
      setBuscaInvestidor('');
      setValorAporte('');
      await onMudou();
    } catch (e) {
      setMsg(mensagemErro(e));
    }
  }

  async function desvincular(titularId: string, nome: string) {
    if (!window.confirm(`Remover ${nome} desta estrutura?`)) return;
    try {
      await capitalService.desvincularInvestidor(estrutura.id, titularId);
      await onMudou();
    } catch (e) {
      setMsg(mensagemErro(e));
    }
  }

  async function criarEVincular() {
    setMsg(null);
    setCriando(true);
    try {
      const digitos = novoDoc.replace(/\D/g, '');
      const t = await titularService.criar({
        nome: novoNome.trim(),
        tipoPessoa: digitos.length > 11 ? 'pj' : 'pf',
        cpfCnpj: digitos,
        whatsapp: novoZap.replace(/\D/g, ''),
      });
      await vincular(t.id);
      setNovoAberto(false);
      setNovoNome('');
      setNovoDoc('');
      setNovoZap('');
    } catch (e) {
      setMsg(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  }

  async function vincularAtivo(ativoId: string) {
    setMsg(null);
    try {
      const r = await capitalService.vincularAtivo(estrutura.id, ativoId);
      if (r.erro) {
        setMsg(r.mensagem ?? 'Não foi possível vincular o ativo.');
        return;
      }
      setBuscaAtivo('');
      await onMudou();
    } catch (e) {
      setMsg(mensagemErro(e));
    }
  }

  const colunasInvestidor: Coluna<InvestidorEstrutura>[] = [
    { chave: 'nome', titulo: 'Investidor', celular: 'titulo', render: (i) => i.nome },
    { chave: 'instrumento', titulo: 'Instrumento', celular: 'campo', render: (i) => (i.tipoInstrumento === 'MUTUO' ? 'Mútuo' : i.tipoInstrumento ?? '—') },
    { chave: 'valor', titulo: 'Valor aportado', alinhar: 'right', classe: 'tabular-nums', celular: 'destaque', render: (i) => reais(i.valorAportado) },
  ];

  return (
    <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
      {/* Investidores */}
      <Secao titulo="Investidores e aportes" tag={`${estrutura.investidores.length}`}>
        <div className="flex flex-col gap-[8px]">
          <Tabela
            colunas={colunasInvestidor}
            linhas={estrutura.investidores}
            chave={(i) => i.titularId}
            vazio="Nenhum investidor vinculado ainda."
            larguraMinima={420}
            acoes={(i) => <Botao tamanho="sm" variante="perigo" onClick={() => desvincular(i.titularId, i.nome)}>Remover</Botao>}
          />
          <div className="grid grid-cols-1 items-end gap-[8px] sm:grid-cols-[1fr_140px]">
            <Campo rotulo="Buscar titular para vincular (mínimo 3 letras)">
              <input value={buscaInvestidor} onChange={(e) => setBuscaInvestidor(e.target.value)} className={inputCls} style={inputStyle} />
            </Campo>
            <Campo rotulo="Valor do aporte (R$)">
              <input value={valorAporte} onChange={(e) => setValorAporte(e.target.value)} placeholder="0,00" className={`${inputCls} text-right`} style={inputStyle} />
            </Campo>
          </div>
          {buscaInvestidor.trim().length >= 3 && (
            <div className="flex flex-col gap-[4px]">
              {(candidatos.data?.data ?? []).slice(0, 6).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => vincular(t.id)}
                  className="flex min-h-[34px] items-center justify-between gap-[8px] rounded-[10px] px-[10px] py-[6px] text-left text-[12px]"
                  style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <span className="font-semibold">{t.nome}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{t.cpfCnpj}</span>
                </button>
              ))}
            </div>
          )}
          {novoAberto ? (
            <div className="grid grid-cols-1 items-end gap-[8px] rounded-[12px] p-[10px] sm:grid-cols-2" style={{ background: 'var(--surface-muted)', border: '1px dashed var(--border)' }}>
              <Campo rotulo="Nome completo da pessoa investidora">
                <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className={inputCls} style={inputStyleClaro} />
              </Campo>
              <Campo rotulo="CPF ou CNPJ">
                <input value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} className={inputCls} style={inputStyleClaro} />
              </Campo>
              <Campo rotulo="WhatsApp">
                <input value={novoZap} onChange={(e) => setNovoZap(e.target.value)} className={inputCls} style={inputStyleClaro} />
              </Campo>
              <div className="flex flex-wrap gap-[6px]">
                <Botao
                  variante="primaria"
                 
                  onClick={criarEVincular}
                  disabled={criando || novoNome.trim().length < 3 || novoDoc.replace(/\D/g, '').length < 11 || novoZap.replace(/\D/g, '').length < 10}
                >
                  {criando ? 'Cadastrando…' : 'Cadastrar e vincular'}
                </Botao>
                <Botao onClick={() => setNovoAberto(false)}>Cancelar</Botao>
              </div>
            </div>
          ) : (
            <div>
              <Botao variante="fantasma" tamanho="sm" onClick={() => setNovoAberto(true)}>+ Cadastrar pessoa investidora nova</Botao>
            </div>
          )}
        </div>
      </Secao>

      {/* Ativos financiados */}
      <Secao titulo="Ativos financiados pela estrutura" tag={`${estrutura.ativos.length}`}>
        <div className="flex flex-col gap-[8px]">
          {estrutura.ativos.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum ativo vinculado ainda.</div>
          ) : (
            <div className="flex flex-wrap gap-[6px]">
              {estrutura.ativos.map((a) => (
                <span key={a.ativoId} className="rounded-full px-[10px] py-[3px] text-[11.5px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {a.descricao}{a.placa ? ` · ${a.placa}` : ''}
                </span>
              ))}
            </div>
          )}
          <Campo rotulo="Buscar ativo pela placa (mínimo 3 caracteres) — o vínculo marca esta estrutura como DONA do ativo">
            <input value={buscaAtivo} onChange={(e) => setBuscaAtivo(e.target.value.toUpperCase())} className={`${inputCls} sm:max-w-[240px]`} style={inputStyle} />
          </Campo>
          {buscaAtivo.trim().length >= 3 && (
            <div className="flex flex-col gap-[4px]">
              {(ativos.data?.data ?? []).slice(0, 6).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => vincularAtivo(a.id)}
                  className="flex min-h-[34px] items-center justify-between gap-[8px] rounded-[10px] px-[10px] py-[6px] text-left text-[12px]"
                  style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <span className="font-semibold">{(a as { descricao?: string }).descricao ?? a.id}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{(a as { placa?: string }).placa ?? ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Secao>

      {msg && <div className="rounded-[10px] p-[8px] text-[12px] lg:col-span-2" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>{msg}</div>}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}</div>
      {children}
    </div>
  );
}
