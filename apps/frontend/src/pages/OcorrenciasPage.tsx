import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rotuloAtivo, formatCurrency } from '@azit/utils';
import { frotaService as svc, type Ocorrencia, type ResumoImportacao } from '../services/frota.service';
import { Modal } from '../components/Modal';
import { acoesDaOcorrencia, ModalAcaoOcorrencia, ModalNovaOcorrencia, type AcaoOcorrencia } from '../components/ocorrencia/AcoesOcorrencia';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole, ROLE_OPERACAO, AREAS_ROTA_CONTRATO } from '../lib/permissoes';
import { OCORRENCIA_STATUS_COLORS, RESPONSAVEL_OCORRENCIA_COLORS } from '../config/statusColors';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import { LinkArea } from '../components/LinkArea';

// Multas e pendências (doc 02 §25.2/§25.3). É um KANBAN porque cada desfecho é
// TRATATIVA MANUAL (decisão Luís 20/09) — ao contrário da frota, que é lista,
// já que o status do veículo muda sozinho com o contrato.
// Layout v2 (doc 03 §11): filtros em Chips, botões do kit, só tokens; o kanban
// permanece — a única faixa que rola na horizontal, e só por dentro.

// Data-calendário direto do ISO (mesma convenção das outras telas): converter
// pelo fuso local faz 01/09 virar 31/08, porque o vencimento é UTC-meia-noite.
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const inputCls = 'w-full rounded-[10px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
// Link com o mesmo desenho do Botao secundário (Botao é <button>; aqui precisa navegar).
const linkSecundario = 'inline-flex h-[30px] items-center rounded-[10px] px-[11px] text-[12px] font-semibold';
const linkSecundarioStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

// Etapas do quadro: as três primeiras são o que espera decisão; a última fecha o ciclo.
const COLUNAS: { chave: string; titulo: string; ajuda: string; status: string[] }[] = [
  { chave: 'novas', titulo: 'Novas', ajuda: 'Chegaram e ainda não têm desfecho', status: ['REGISTRADA'] },
  { chave: 'recurso', titulo: 'Em recurso', ajuda: 'Aguardando decisão do órgão', status: ['EM_RECURSO'] },
  { chave: 'comprovante', titulo: 'Aguardando comprovante', ajuda: 'Cliente ficou de pagar direto', status: ['AGUARDANDO_COMPROVANTE'] },
  { chave: 'encerradas', titulo: 'Encerradas', ajuda: 'Cobradas, quitadas, assumidas ou canceladas', status: ['REPASSADA', 'QUITADA', 'ASSUMIDA_AZIT', 'CANCELADA'] },
];

function Card({ o, onAbrir }: { o: Ocorrencia; onAbrir: () => void }) {
  const cor = OCORRENCIA_STATUS_COLORS[o.status];
  const corResp = RESPONSAVEL_OCORRENCIA_COLORS[o.responsavel];
  const prazoVencido = o.status === 'AGUARDANDO_COMPROVANTE' && !!o.prazoComprovante && new Date(o.prazoComprovante) < new Date();
  return (
    <button type="button" onClick={onAbrir} title="Abrir a ocorrência"
      className="w-full cursor-pointer rounded-[12px] p-[11px] text-left transition-[filter] hover:brightness-[1.03]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>{o.ativo.placa ?? 'sem placa'}</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{o.tipoRotulo}{o.numeroAuto ? ` · ${o.numeroAuto}` : ''}</div>
        </div>
        <span className="whitespace-nowrap rounded-full px-[8px] py-[1px] text-[10px] font-bold" style={{ background: corResp.bg, color: corResp.fg }}>
          {o.responsavel === 'CLIENTE' ? 'cliente' : 'Azit'}
        </span>
      </div>
      {o.contrato && (
        <div className="mt-[4px] truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.contrato.titular.nome}</div>
      )}
      <div className="mt-[7px] flex items-center justify-between">
        <span className="font-display text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(o.valorComDesconto ?? o.valor)}</span>
        <span className="text-[10.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>fato {dataBR(o.dataFato)}</span>
      </div>
      {o.status === 'AGUARDANDO_COMPROVANTE' && o.prazoComprovante && (
        <div className="mt-[5px] text-[10.5px] tabular-nums" style={{ color: prazoVencido ? OCORRENCIA_STATUS_COLORS.CANCELADA.fg : 'var(--text-muted)' }}>
          comprovante até {dataBR(o.prazoComprovante)}{prazoVencido ? ' · atrasado' : ''}
        </div>
      )}
      {o.repasse && (
        <div className="mt-[5px] text-[10.5px]" style={{ color: 'var(--text-muted)' }}>fatura {o.repasse.faturaNumero} · venc. {dataBR(o.repasse.vencimento)}</div>
      )}
      {['REPASSADA', 'QUITADA', 'ASSUMIDA_AZIT', 'CANCELADA'].includes(o.status) && (
        <span className="mt-[6px] inline-block rounded-full px-[8px] py-[1px] text-[10px] font-bold" style={{ background: cor.bg, color: cor.fg }}>{o.statusRotulo}</span>
      )}
    </button>
  );
}

export function OcorrenciasPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const [params, setParams] = useSearchParams();
  const ativoId = params.get('ativo') ?? undefined;
  const [filtros, setFiltros] = useState({ tipo: '', responsavel: '', busca: '' });
  const lista = useQuery({
    queryKey: ['ocorrencias', filtros, ativoId],
    queryFn: () => svc.ocorrencias({ ativoId, tipo: filtros.tipo || undefined, responsavel: filtros.responsavel || undefined, busca: filtros.busca || undefined }),
  });
  const opcoes = useQuery({ queryKey: ['frota-opcoes'], queryFn: () => svc.opcoes() });

  const [detalhe, setDetalhe] = useState<Ocorrencia | null>(null);
  const [acao, setAcao] = useState<{ tipo: AcaoOcorrencia; o: Ocorrencia } | null>(null);
  const [nova, setNova] = useState(false);
  const [importar, setImportar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [credencial, setCredencial] = useState({ usuario: '', senha: '' });
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);

  const itens = lista.data ?? [];

  // O alerta de prazo (sino) abre a OCORRÊNCIA, não o quadro inteiro (?id=…).
  const idAberto = params.get('id');
  useEffect(() => {
    if (!idAberto || !lista.data) return;
    const alvo = lista.data.find((o) => o.id === idAberto);
    if (alvo) setDetalhe(alvo);
    // Abre uma vez: tira o id do endereço para a lista recarregada não reabrir o detalhe.
    const resto = new URLSearchParams(params);
    resto.delete('id');
    setParams(resto, { replace: true });
  }, [idAberto, lista.data, params, setParams]);

  const recarregar = () => qc.invalidateQueries({ queryKey: ['ocorrencias'] });

  async function executarImportacao() {
    setOcupado(true);
    setResumo(null);
    try {
      const r = await svc.importarInfleet(credencial.usuario, credencial.senha);
      setCredencial({ usuario: '', senha: '' }); // não fica nem na tela
      setResumo(r);
      toast.sucesso(`${r.criadas} nova(s), ${r.atualizadas} atualizada(s).`);
      await qc.invalidateQueries({ queryKey: ['ocorrencias'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="max-w-[680px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Cada cartão espera uma decisão sua: cobrar do cliente, deixar que ele pague direto ou a Azit assumir. O
          responsável vem da <b>data do fato</b> (cláusulas 6.4 e 6.7 do contrato).
        </p>
        <div className="flex flex-wrap gap-[8px]">
          <Link to="/ativos" className={linkSecundario} style={linkSecundarioStyle}>Frota e estoque</Link>
          {podeOperar && <Botao variante="secundaria" tamanho="sm" onClick={() => { setResumo(null); setImportar(true); }}>Importar do Infleet</Botao>}
          {podeOperar && <Botao variante="primaria" tamanho="sm" onClick={() => setNova(true)}>Nova ocorrência</Botao>}
        </div>
      </div>

      {/* Filtros: tipo e responsável em chips (filtram no servidor — sem contagem), busca em texto */}
      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[8px]">
        <Chips
          tamanho="sm"
          itens={(opcoes.data?.tipos ?? []).map((t) => ({ chave: t.valor, rotulo: t.rotulo }))}
          valor={filtros.tipo || null}
          onChange={(k) => setFiltros({ ...filtros, tipo: k ?? '' })}
          todos="Todos os tipos"
        />
        <Chips
          tamanho="sm"
          itens={[{ chave: 'CLIENTE', rotulo: 'Do cliente' }, { chave: 'AZIT', rotulo: 'Da Azit' }]}
          valor={filtros.responsavel || null}
          onChange={(k) => setFiltros({ ...filtros, responsavel: k ?? '' })}
          todos="Cliente e Azit"
        />
        <input className="h-[30px] min-w-[180px] flex-1 rounded-full px-[12px] text-[12px] sm:max-w-[260px]" style={inputStyle} placeholder="Placa ou número do auto" aria-label="Buscar placa ou número do auto"
          value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
      </div>

      {/* Kanban: a faixa rola na horizontal só por dentro (única exceção da regra mobile). */}
      <div className="flex min-w-0 flex-1 gap-[13px] overflow-x-auto pb-[8px]">
        {COLUNAS.map((col) => {
          const cards = itens.filter((o) => col.status.includes(o.status));
          const cor = OCORRENCIA_STATUS_COLORS[col.status[0]];
          const total = cards.reduce((s, o) => s + (o.valorComDesconto ?? o.valor), 0);
          return (
            <div key={col.chave} className="flex w-[240px] flex-none flex-col rounded-card" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-[8px] px-[13px] py-[11px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="mt-[4px] h-[9px] w-[9px] flex-none rounded-full" style={{ background: cor.fg }} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>{col.titulo}</div>
                  <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }} title={col.ajuda}>{col.ajuda}</div>
                  {total > 0 && <div className="text-[10.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatCurrency(total)}</div>}
                </div>
                <div className="font-display text-[16px] font-bold tabular-nums" style={{ color: cor.fg }}>{cards.length}</div>
              </div>
              <div className="flex flex-1 flex-col gap-[9px] overflow-auto p-[11px]">
                {lista.isLoading && <div className="py-[10px] text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}
                {!lista.isLoading && cards.length === 0 && <div className="py-[10px] text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>Vazio</div>}
                {cards.map((o) => <Card key={o.id} o={o} onAbrir={() => setDetalhe(o)} />)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detalhe + tratativas */}
      {detalhe && (
        <Modal open onClose={() => setDetalhe(null)} title={`${detalhe.tipoRotulo} — ${detalhe.ativo.placa ?? 'sem placa'}`} largura={540}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <div className="flex flex-wrap gap-[6px]">
              <span className="rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: OCORRENCIA_STATUS_COLORS[detalhe.status].bg, color: OCORRENCIA_STATUS_COLORS[detalhe.status].fg }}>{detalhe.statusRotulo}</span>
              <span className="rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: RESPONSAVEL_OCORRENCIA_COLORS[detalhe.responsavel].bg, color: RESPONSAVEL_OCORRENCIA_COLORS[detalhe.responsavel].fg }}>
                {detalhe.responsavel === 'CLIENTE' ? 'Responsável: cliente' : 'Responsável: Azit'}
              </span>
              {detalhe.origem !== 'manual' && <span className="rounded-full px-[9px] py-[2px] text-[11px]" style={{ background: 'var(--surface-input)', color: 'var(--text-muted)' }}>origem: {detalhe.origem}</span>}
            </div>
            <div className="grid grid-cols-1 gap-x-[16px] gap-y-[4px] sm:grid-cols-2" style={{ color: 'var(--text-body)' }}>
              <span>Veículo: <b style={{ color: 'var(--text-primary)' }}>{rotuloAtivo(detalhe.ativo)}</b></span>
              <span>Valor: <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(detalhe.valorComDesconto ?? detalhe.valor)}</b></span>
              <span>Data do fato: <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{dataBR(detalhe.dataFato)}</b></span>
              <span>Vencimento: <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{dataBR(detalhe.dataVencimento)}</b></span>
              {detalhe.numeroAuto && <span>Auto: <b style={{ color: 'var(--text-primary)' }}>{detalhe.numeroAuto}</b></span>}
              {detalhe.orgao && <span>Órgão: <b style={{ color: 'var(--text-primary)' }}>{detalhe.orgao}</b></span>}
              {detalhe.prazoIndicacao && <span>Indicação até: <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{dataBR(detalhe.prazoIndicacao)}</b></span>}
              {detalhe.contrato && (
                <span>Cliente: <LinkArea area={AREAS_ROTA_CONTRATO} to={`/contratos/${detalhe.contrato.id}`} className="font-bold hover:underline" style={{ color: 'var(--text-primary)' }}>{detalhe.contrato.titular.nome}</LinkArea></span>
              )}
            </div>
            {detalhe.descricao && <div style={{ color: 'var(--text-muted)' }}>{detalhe.descricao}</div>}
            {detalhe.responsavelJustificativa && <div style={{ color: 'var(--text-muted)' }}>Responsável alterado: {detalhe.responsavelJustificativa}</div>}
            {detalhe.desfechoObs && <div style={{ color: 'var(--text-muted)' }}>Desfecho: {detalhe.desfechoObs}</div>}
            {detalhe.repasse && <div style={{ color: 'var(--text-muted)' }}>Cobrado na fatura {detalhe.repasse.faturaNumero}, com vencimento em {dataBR(detalhe.repasse.vencimento)}.</div>}

            <div className="flex flex-wrap justify-end gap-[8px] pt-[4px]">
              <Link to={`/ativos/${detalhe.ativo.id}`} className={linkSecundario} style={linkSecundarioStyle}>Ficha do veículo</Link>
              {detalhe.temComprovante && <Botao variante="secundaria" tamanho="sm" onClick={() => svc.abrirComprovante(detalhe.id)}>Ver comprovante</Botao>}
              {acoesDaOcorrencia(detalhe, podeOperar).map((b) => (
                <Botao key={b.acao} variante={b.variante} tamanho="sm" onClick={() => { setDetalhe(null); setAcao({ tipo: b.acao, o: detalhe }); }}>{b.rotulo}</Botao>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {acao && <ModalAcaoOcorrencia acao={acao.tipo} o={acao.o} onFechar={() => setAcao(null)} onFeito={recarregar} />}

      {nova && <ModalNovaOcorrencia onFechar={() => setNova(false)} onFeito={recarregar} />}

      {importar && (
        <Modal open onClose={() => { setImportar(false); setCredencial({ usuario: '', senha: '' }); }} title="Importar multas do Infleet" largura={560}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>
              O Infleet não fornece credencial de integração, então o sistema entra lá como você, num navegador no
              servidor, e lê o quadro de infrações. <b>Sua senha não é guardada</b>: ela existe só durante esta
              importação — não vai para banco, log nem fila.
            </p>
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              <label className="flex flex-col gap-[4px]">Usuário do Infleet
                <input className={inputCls} style={inputStyle} autoComplete="off" value={credencial.usuario} onChange={(e) => setCredencial({ ...credencial, usuario: e.target.value })} />
              </label>
              <label className="flex flex-col gap-[4px]">Senha
                <input type="password" className={inputCls} style={inputStyle} autoComplete="new-password" value={credencial.senha} onChange={(e) => setCredencial({ ...credencial, senha: e.target.value })} />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => { setImportar(false); setCredencial({ usuario: '', senha: '' }); }}>Fechar</Botao>
              <Botao variante="primaria" tamanho="sm" disabled={ocupado || !credencial.usuario || !credencial.senha}
                onClick={() => void executarImportacao()}>
                {ocupado ? 'Importando… (pode levar 1 min)' : 'Importar agora'}
              </Botao>
            </div>

            {resumo && (
              <div className="flex flex-col gap-[6px] rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
                <div><b>{resumo.lidas}</b> registro(s) lido(s) · <b>{resumo.criadas}</b> nova(s) · <b>{resumo.atualizadas}</b> atualizada(s)</div>
                {resumo.ignoradas.length > 0 && (
                  <div>
                    <div className="font-semibold">Ignoradas ({resumo.ignoradas.length}):</div>
                    {resumo.ignoradas.slice(0, 8).map((i, n) => (
                      <div key={n} className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{i.placa ?? '?'} {i.numeroAuto ?? ''} — {i.motivo}</div>
                    ))}
                  </div>
                )}
                {resumo.naoMapeadas > 0 && (
                  <div className="text-[11.5px]" style={{ color: OCORRENCIA_STATUS_COLORS.CANCELADA.fg }}>
                    {resumo.naoMapeadas} registro(s) vieram num formato que ainda não sei ler. Mande este trecho para o
                    time de desenvolvimento:
                    <pre className="mt-[4px] max-h-[160px] overflow-auto whitespace-pre-wrap rounded-[8px] p-[8px] text-[10.5px]" style={{ background: 'var(--surface)' }}>
                      {JSON.stringify(resumo.amostraBruta, null, 1)?.slice(0, 1200)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
