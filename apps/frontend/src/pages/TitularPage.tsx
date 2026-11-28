import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { titularService } from '../services/titular.service';
import { FormularioTitular } from '../components/FormularioTitular';
import { StatusBadge } from '../components/StatusBadge';
import { CONTRATO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, AREAS_ROTA_CONTRATO, useIrParaArea } from '../lib/permissoes';
import { instanteBR } from '../lib/datas';
import { Tabela } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Layout v2 (doc 03 §11): lista em Tabela responsiva (celular = cartões), ficha
// em Secaos, botões do kit; só tokens de cor.
const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
const card = { background: 'var(--surface)', border: '1px solid var(--border)' };
const soNumeros = (s: string) => /\d/.test(s) && !/[a-zA-Z]/.test(s);

export function TitularPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const irParaArea = useIrParaArea();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_OPERACAO);
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const lista = useQuery({
    queryKey: ['titulares', termo],
    queryFn: () => titularService.listar(soNumeros(termo) ? { cpfCnpj: termo } : termo ? { nome: termo } : {}),
  });
  const ficha = useQuery({
    queryKey: ['titular-ficha', selId],
    queryFn: () => titularService.ficha(selId!),
    enabled: !!selId,
  });
  function abrir(id: string) { setSelId(id); setEditando(false); }


  const f = ficha.data;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setTermo(busca)}
          placeholder="Buscar por nome ou CPF" aria-label="Buscar titular" className={`${inputCls} min-w-0 flex-1 sm:max-w-[280px]`} style={inStyle} />
        <Botao variante="primaria" onClick={() => setTermo(busca)}>Buscar</Botao>
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[1fr_1.4fr]">
        {/* Lista — o titular selecionado fica marcado em acento (a Tabela não tem estado de seleção próprio) */}
        <div className="self-start">
          <Tabela
            colunas={[
              {
                chave: 'nome',
                titulo: 'Nome',
                celular: 'titulo',
                render: (t) => <span style={{ color: selId === t.id ? 'var(--accent)' : undefined }}>{selId === t.id ? '› ' : ''}{t.nome}</span>,
              },
              { chave: 'cpf', titulo: 'CPF/CNPJ', celular: 'subtitulo', classe: 'tabular-nums', render: (t) => t.cpfCnpj },
            ]}
            linhas={lista.data?.data ?? []}
            chave={(t) => t.id}
            onClick={(t) => abrir(t.id)}
            carregando={lista.isLoading}
            larguraMinima={320}
            vazio="Nenhum titular."
          />
        </div>

        {/* Ficha */}
        <div className="flex flex-col gap-[16px]">
          {!selId && <div className="rounded-card p-[18px] text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>Selecione um titular para ver a ficha.</div>}
          {selId && f && (
            <>
              {/* Cadastro vivo */}
              <div className="rounded-card p-[18px]" style={card}>
                <div className="mb-[12px] flex flex-wrap items-center justify-between gap-[8px]">
                  <div className="font-display text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{f.titular.nome}</div>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    {selId && <Botao variante="primaria" tamanho="sm" onClick={() => navigate(`/titulares/${selId}`)}>Detalhe completo</Botao>}
                    {podeEditar && <Botao variante="secundaria" tamanho="sm" onClick={() => setEditando(true)}>Editar cadastro</Botao>}
                  </div>
                </div>
                <Secao titulo="Cadastro vivo">
                    <div className="grid grid-cols-1 gap-y-[6px] gap-x-[16px] text-[12.5px] sm:grid-cols-2" style={{ color: 'var(--text-primary)' }}>
                      <div><span style={{ color: 'var(--text-label)' }}>CPF/CNPJ:</span> {f.titular.cpfCnpj}</div>
                      <div><span style={{ color: 'var(--text-label)' }}>WhatsApp:</span> {f.titular.whatsapp}</div>
                      <div><span style={{ color: 'var(--text-label)' }}>E-mail:</span> {f.titular.email ?? '—'}</div>
                      <div><span style={{ color: 'var(--text-label)' }}>Profissão:</span> {f.titular.profissao ?? '—'}</div>
                      <div className="sm:col-span-2"><span style={{ color: 'var(--text-label)' }}>Endereço:</span> {f.titular.endereco ?? '—'}{f.titular.cidade ? `, ${f.titular.cidade}/${f.titular.estado ?? ''}` : ''}</div>
                    </div>
                </Secao>
                {editando && (
                  <FormularioTitular
                    titular={f.titular}
                    onFechar={() => setEditando(false)}
                    onSalvo={async () => {
                      await queryClient.invalidateQueries({ queryKey: ['titular-ficha', selId] });
                      await queryClient.invalidateQueries({ queryKey: ['titulares'] });
                    }}
                  />
                )}
                {f.conta && <div className="mt-[12px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Conta aberta em {instanteBR(f.conta.dataAbertura)} · {f.conta.status}</div>}
              </div>

              {/* Contratos pendurados */}
              <Secao titulo="Contratos de crédito" tag={`${f.contratosCredito.length}`}>
                <Tabela
                  colunas={[
                    { chave: 'numero', titulo: 'Contrato', celular: 'titulo', render: (c) => c.numero },
                    { chave: 'saldo', titulo: 'Saldo devedor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (c) => formatCurrency(c.saldoDevedor) },
                    { chave: 'status', titulo: 'Status', celular: 'campo', render: (c) => <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} /> },
                  ]}
                  linhas={f.contratosCredito}
                  chave={(c) => c.id}
                  onClick={(c) => irParaArea(AREAS_ROTA_CONTRATO, `/contratos/${c.id}`)}
                  larguraMinima={360}
                  vazio="Nenhum."
                />
              </Secao>
              {f.contratosInvestimento.length > 0 && (
                <Secao titulo="Contratos de investimento" tag={`${f.contratosInvestimento.length}`}>
                  <Tabela
                    colunas={[
                      { chave: 'numero', titulo: 'Contrato', celular: 'titulo', render: (c) => c.numero },
                      { chave: 'aporte', titulo: 'Valor aportado', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (c) => formatCurrency(c.valorAportado) },
                      { chave: 'status', titulo: 'Status', celular: 'campo', render: (c) => <span style={{ color: 'var(--text-muted)' }}>{c.status}</span> },
                    ]}
                    linhas={f.contratosInvestimento}
                    chave={(c) => c.id}
                    larguraMinima={360}
                  />
                </Secao>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
