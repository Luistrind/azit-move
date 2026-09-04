import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  capitalService,
  EstruturaJuridica,
  NOME_TIPO_ESTRUTURA,
} from '../services/capital.service';
import { titularService } from '../services/titular.service';
import { ativoService } from '../services/ativo.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro } from '../lib/permissoes';
import { hojeLocalISO } from '../lib/datas';

// Capital e investimento (doc 02 §15, reunião 18/07): estrutura jurídica (SPE/fundo,
// por rodada) é a dona do capital; investidor pessoa física nunca é dono direto do ativo.

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

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

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Estruturas jurídicas</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          A estrutura (sociedade de propósito específico ou fundo, por rodada de captação) é a dona do
          capital. Investidores aportam na estrutura; a estrutura financia os ativos.
        </p>
      </div>

      <div>
        <button
          onClick={() => setCriando((v) => !v)}
          className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
          style={{ background: 'var(--navy)', color: '#fff' }}
        >
          {criando ? 'Cancelar' : '+ Nova estrutura'}
        </button>
      </div>

      {criando && (
        <FormNovaEstrutura
          onCriada={async () => {
            setCriando(false);
            await recarregar();
          }}
        />
      )}

      {estruturas.isLoading ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (estruturas.data ?? []).length === 0 ? (
        <div className="rounded-[14px] p-[20px] text-[13px]" style={cardStyle}>
          Nenhuma estrutura cadastrada. Crie a primeira para começar a registrar aportes.
        </div>
      ) : (
        (estruturas.data ?? []).map((e) => (
          <CartaoEstrutura
            key={e.id}
            estrutura={e}
            aberta={abertaId === e.id}
            onAbrir={() => setAbertaId(abertaId === e.id ? null : e.id)}
            onMudou={recarregar}
          />
        ))
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
    <div className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={cardStyle}>
      <div className="text-[13px] font-bold">Nova estrutura jurídica</div>
      <div className="flex flex-wrap items-end gap-[10px]">
        <Campo rotulo="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: SPE Azit Rodada 2" className={`${inputCls} w-[240px]`} style={inputStyle} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${inputCls} w-[240px]`} style={inputStyle}>
            {Object.entries(NOME_TIPO_ESTRUTURA).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="CNPJ (se já constituída)">
          <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} className={`${inputCls} w-[170px]`} style={inputStyle} />
        </Campo>
        <Campo rotulo="Rodada de captação">
          <input value={rodada} onChange={(e) => setRodada(e.target.value)} placeholder="ex.: Rodada 2 — 2026" className={`${inputCls} w-[170px]`} style={inputStyle} />
        </Campo>
        <button onClick={criar} className="h-[32px] rounded-[8px] px-[14px] text-[12.5px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
          Criar estrutura
        </button>
      </div>
      {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
    </div>
  );
}

function CartaoEstrutura({
  estrutura,
  aberta,
  onAbrir,
  onMudou,
}: {
  estrutura: EstruturaJuridica;
  aberta: boolean;
  onAbrir: () => void;
  onMudou: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-[12px] rounded-[14px] p-[16px]" style={cardStyle}>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div>
          <div className="text-[14px] font-bold">{estrutura.nome}</div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {NOME_TIPO_ESTRUTURA[estrutura.tipo] ?? estrutura.tipo}
            {estrutura.rodada ? ` · ${estrutura.rodada}` : ''}
            {estrutura.cnpj ? ` · CNPJ ${estrutura.cnpj}` : ' · CNPJ a constituir'}
          </div>
        </div>
        <div className="flex items-center gap-[12px]">
          <div className="text-right">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Total aportado</div>
            <div className="text-[14px] font-bold">{reais(estrutura.totalAportado)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Investidores · Ativos</div>
            <div className="text-[14px] font-bold">
              {estrutura.investidores.length} · {estrutura.ativos.length}
            </div>
          </div>
          <button
            onClick={onAbrir}
            className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold"
            style={{ background: 'var(--navy)', color: '#fff' }}
          >
            {aberta ? 'Fechar' : 'Gerenciar'}
          </button>
        </div>
      </div>

      {aberta && <PainelEstrutura estrutura={estrutura} onMudou={onMudou} />}
    </div>
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
        dataAporte: hojeLocalISO(),
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

  return (
    <div className="flex flex-col gap-[14px] rounded-[12px] p-[14px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
      {/* Investidores */}
      <div>
        <div className="mb-[6px] text-[12.5px] font-bold">Investidores e aportes</div>
        {estrutura.investidores.length === 0 ? (
          <div className="mb-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum investidor vinculado ainda.</div>
        ) : (
          <table className="mb-[8px] w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                <th className="pb-[6px] font-semibold">Investidor</th>
                <th className="pb-[6px] font-semibold">Valor aportado</th>
                <th className="pb-[6px] font-semibold">Instrumento</th>
                <th className="pb-[6px]" />
              </tr>
            </thead>
            <tbody>
              {estrutura.investidores.map((i) => (
                <tr key={i.titularId} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="py-[7px] font-semibold">{i.nome}</td>
                  <td className="py-[7px]">{reais(i.valorAportado)}</td>
                  <td className="py-[7px]">{i.tipoInstrumento === 'MUTUO' ? 'Mútuo' : i.tipoInstrumento ?? '—'}</td>
                  <td className="py-[7px] text-right">
                    <button
                      onClick={() => desvincular(i.titularId, i.nome)}
                      className="rounded-[7px] px-[8px] py-[4px] text-[11px] font-semibold"
                      style={{ background: '#fff', border: '1px solid var(--border)', color: '#a12622' }}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-end gap-[8px]">
          <Campo rotulo="Buscar titular para vincular (mínimo 3 letras)">
            <input value={buscaInvestidor} onChange={(e) => setBuscaInvestidor(e.target.value)} className={`${inputCls} w-[240px]`} style={{ background: '#fff', border: '1px solid var(--border)' }} />
          </Campo>
          <Campo rotulo="Valor do aporte (R$)">
            <input value={valorAporte} onChange={(e) => setValorAporte(e.target.value)} placeholder="0,00" className={`${inputCls} w-[130px] text-right`} style={{ background: '#fff', border: '1px solid var(--border)' }} />
          </Campo>
        </div>
        {buscaInvestidor.trim().length >= 3 && (
          <div className="mt-[6px] flex flex-col gap-[4px]">
            {(candidatos.data?.data ?? []).slice(0, 6).map((t) => (
              <button
                key={t.id}
                onClick={() => vincular(t.id)}
                className="flex items-center justify-between rounded-[8px] px-[10px] py-[6px] text-left text-[12px]"
                style={{ background: '#fff', border: '1px solid var(--border)' }}
              >
                <span className="font-semibold">{t.nome}</span>
                <span style={{ color: 'var(--text-muted)' }}>{t.cpfCnpj}</span>
              </button>
            ))}
          </div>
        )}
        {novoAberto ? (
          <div className="mt-[8px] flex flex-wrap items-end gap-[8px] rounded-[10px] p-[10px]" style={{ background: '#fff', border: '1px dashed var(--border)' }}>
            <Campo rotulo="Nome completo da pessoa investidora">
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className={`${inputCls} w-[220px]`} style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </Campo>
            <Campo rotulo="CPF ou CNPJ">
              <input value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} className={`${inputCls} w-[160px]`} style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </Campo>
            <Campo rotulo="WhatsApp">
              <input value={novoZap} onChange={(e) => setNovoZap(e.target.value)} className={`${inputCls} w-[140px]`} style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </Campo>
            <button
              onClick={criarEVincular}
              disabled={criando || novoNome.trim().length < 3 || novoDoc.replace(/\D/g, '').length < 11 || novoZap.replace(/\D/g, '').length < 10}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-bold disabled:opacity-40"
              style={{ background: 'var(--navy)', color: '#fff' }}
            >
              {criando ? 'Cadastrando…' : 'Cadastrar e vincular'}
            </button>
            <button onClick={() => setNovoAberto(false)} className="rounded-[8px] px-[10px] py-[7px] text-[12px] font-semibold" style={{ background: '#fff', border: '1px solid var(--border)' }}>
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => setNovoAberto(true)}
            className="mt-[8px] rounded-[8px] px-[10px] py-[6px] text-[12px] font-semibold"
            style={{ background: '#fff', border: '1px dashed var(--border)', color: 'var(--text-muted)' }}
          >
            + Cadastrar pessoa investidora nova
          </button>
        )}
      </div>

      {/* Ativos financiados */}
      <div>
        <div className="mb-[6px] text-[12.5px] font-bold">Ativos financiados pela estrutura</div>
        {estrutura.ativos.length === 0 ? (
          <div className="mb-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum ativo vinculado ainda.</div>
        ) : (
          <div className="mb-[8px] flex flex-wrap gap-[6px]">
            {estrutura.ativos.map((a) => (
              <span key={a.ativoId} className="rounded-full px-[10px] py-[3px] text-[11.5px] font-semibold" style={{ background: '#fff', border: '1px solid var(--border)' }}>
                {a.descricao}{a.placa ? ` · ${a.placa}` : ''}
              </span>
            ))}
          </div>
        )}
        <Campo rotulo="Buscar ativo pela placa (mínimo 3 caracteres) — o vínculo marca esta estrutura como DONA do ativo">
          <input value={buscaAtivo} onChange={(e) => setBuscaAtivo(e.target.value.toUpperCase())} className={`${inputCls} w-[200px]`} style={{ background: '#fff', border: '1px solid var(--border)' }} />
        </Campo>
        {buscaAtivo.trim().length >= 3 && (
          <div className="mt-[6px] flex flex-col gap-[4px]">
            {(ativos.data?.data ?? []).slice(0, 6).map((a) => (
              <button
                key={a.id}
                onClick={() => vincularAtivo(a.id)}
                className="flex items-center justify-between rounded-[8px] px-[10px] py-[6px] text-left text-[12px]"
                style={{ background: '#fff', border: '1px solid var(--border)' }}
              >
                <span className="font-semibold">{(a as { descricao?: string }).descricao ?? a.id}</span>
                <span style={{ color: 'var(--text-muted)' }}>{(a as { placa?: string }).placa ?? ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {msg && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fff7e6', color: '#8a5a00' }}>{msg}</div>}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{rotulo}</div>
      {children}
    </div>
  );
}
