import { useState } from 'react';
import { MOTIVO_PREPARACAO_LABEL, MotivoPreparacao, SITUACAO_ITEM_PREPARACAO_LABEL, SituacaoItemPreparacao } from '@azit/types';
import { ativoService, type ItemPreparacao, type Preparacao, type PreparacoesDoVeiculo } from '../../services/ativo.service';
import { Botao } from '../../components/Botao';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { mensagemErro } from '../../lib/permissoes';
import { dataMistaBR, instanteBR } from '../../lib/datas';

// Preparação para venda na ficha do veículo (doc 02 §25.8, decisão Luís 24/11):
// Recuperado → "Liberar para venda"; Disponível → "Enviar para preparação";
// com a preparação aberta, o checklist (feito / não se aplica) e "Marcar como
// pronto", que só libera com todos os itens resolvidos. É a única exceção ao
// "status automático": entra e sai só por estas ações, auditadas.

const rotulo = 'text-[10.5px] font-semibold uppercase tracking-[0.08em]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const motivoLabel = (m: string) => MOTIVO_PREPARACAO_LABEL[m as MotivoPreparacao] ?? m;
const situacaoLabel = (s: string) => SITUACAO_ITEM_PREPARACAO_LABEL[s as SituacaoItemPreparacao] ?? s;

function ModalAbrir({ titulo, explicacao, onFechar, onConfirmar }: { titulo: string; explicacao: string; onFechar: () => void; onConfirmar: (oQueFalta: string) => Promise<void> }) {
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onFechar} title={titulo}>
      <div className="flex flex-col gap-[10px] text-[12.5px]">
        <p style={{ color: 'var(--text-muted)' }}>{explicacao}</p>
        <label className="flex flex-col gap-[4px]">
          O que falta (opcional)
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Ex.: na oficina trocando a embreagem; aguardando o documento"
            className="w-full rounded-[10px] px-[10px] py-[7px] text-[13px]"
            style={inStyle}
          />
        </label>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="secundaria" tamanho="sm" onClick={onFechar}>Cancelar</Botao>
          <Botao
            variante="primaria"
            tamanho="sm"
            carregando={ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await onConfirmar(texto.trim());
                onFechar();
              } catch (e) {
                toast.erro(mensagemErro(e));
              } finally {
                setOcupado(false);
              }
            }}
          >
            {titulo}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

function LinhaItem({ item, podeOperar, ocupado, onMarcar, onRemover }: { item: ItemPreparacao; podeOperar: boolean; ocupado: boolean; onMarcar: (s: ItemPreparacao['situacao']) => void; onRemover: () => void }) {
  const feito = item.situacao === 'feito';
  const na = item.situacao === 'nao_se_aplica';
  return (
    <div className="flex flex-wrap items-center gap-[10px] px-[18px] py-[9px]" style={{ borderTop: '1px solid var(--border-light)' }}>
      <span
        aria-hidden
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] text-[11px] font-bold"
        style={{ background: item.situacao ? 'var(--ok-bg)' : 'var(--surface-input)', color: item.situacao ? 'var(--ok-fg)' : 'var(--text-muted)', border: '1px solid var(--border)' }}
      >
        {feito ? '✓' : na ? '–' : ''}
      </span>
      <span className="min-w-0 flex-[1_1_220px]">
        <span style={{ color: 'var(--text-primary)', textDecoration: na ? 'line-through' : undefined }}>{item.descricao}</span>
        {item.avulso && <span className="ml-[6px] text-[11px]" style={{ color: 'var(--text-muted)' }}>só deste carro</span>}
        <span className="block text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {item.situacao ? `${situacaoLabel(item.situacao)}${item.marcadoPor ? ` por ${item.marcadoPor}` : ''}${item.marcadoEm ? ` em ${instanteBR(item.marcadoEm)}` : ''}` : 'pendente'}
        </span>
      </span>
      {podeOperar && (
        <span className="flex flex-none flex-wrap items-center gap-[6px]">
          {item.situacao ? (
            <Botao variante="fantasma" tamanho="sm" disabled={ocupado} onClick={() => onMarcar(null)}>Desmarcar</Botao>
          ) : (
            <>
              <Botao variante="secundaria" tamanho="sm" disabled={ocupado} onClick={() => onMarcar('feito')}>Feito</Botao>
              <Botao variante="fantasma" tamanho="sm" disabled={ocupado} onClick={() => onMarcar('nao_se_aplica')}>Não se aplica</Botao>
            </>
          )}
          {item.avulso && <Botao variante="fantasma" tamanho="sm" disabled={ocupado} onClick={onRemover}>Remover</Botao>}
        </span>
      )}
    </div>
  );
}

function Historico({ anteriores }: { anteriores: Preparacao[] }) {
  const [aberto, setAberto] = useState(false);
  if (!anteriores.length) return null;
  return (
    <div className="px-[18px] py-[10px] text-[12px]" style={{ borderTop: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
      <button type="button" className="font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setAberto(!aberto)}>
        {aberto ? '▾' : '▸'} {anteriores.length === 1 ? '1 preparação anterior' : `${anteriores.length} preparações anteriores`}
      </button>
      {aberto && (
        <ul className="mt-[6px] flex flex-col gap-[6px]">
          {anteriores.map((p) => (
            <li key={p.id}>
              <b style={{ color: 'var(--text-body)' }}>{motivoLabel(p.motivo)}</b> · aberta em {dataMistaBR(p.abertaEm)}
              {p.abertaPor ? ` por ${p.abertaPor}` : ''} · pronta em {dataMistaBR(p.concluidaEm)}
              {p.concluidaPor ? ` por ${p.concluidaPor}` : ''}
              <span className="block">
                {p.itens.map((i) => `${i.descricao} (${i.situacao ? situacaoLabel(i.situacao).toLowerCase() : 'pendente'})`).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PreparacaoVeiculo({
  ativoId,
  status,
  ehVeiculo,
  preparacao,
  podeOperar,
  onMudou,
}: {
  ativoId: string;
  status: string;
  ehVeiculo: boolean;
  preparacao: PreparacoesDoVeiculo | undefined;
  podeOperar: boolean;
  onMudou: () => Promise<void>;
}) {
  const [abrir, setAbrir] = useState<'liberar' | 'enviar' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [novoItem, setNovoItem] = useState('');
  if (!ehVeiculo) return null;
  const aberta = preparacao?.aberta ?? null;
  const anteriores = preparacao?.anteriores ?? [];
  const podeLiberar = podeOperar && !aberta && status === 'recuperado';
  const podeEnviar = podeOperar && !aberta && status === 'disponivel';
  // "Não mostra o que não existe": sem preparação, sem histórico e sem ação, nada.
  if (!aberta && !anteriores.length && !podeLiberar && !podeEnviar) return null;

  async function rodar(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    try {
      await fn();
      await onMudou();
      if (ok) toast.sucesso(ok);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const pendentes = aberta ? aberta.itens.filter((i) => !i.situacao).length : 0;

  return (
    <section className="overflow-hidden rounded-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-center gap-[10px] px-[18px] py-[12px]">
        <div className="min-w-0 flex-[1_1_260px]">
          <div className={rotulo} style={{ color: 'var(--text-label)' }}>Preparação para venda</div>
          <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            {aberta ? (
              <>
                {motivoLabel(aberta.motivo)} · aberta em {dataMistaBR(aberta.abertaEm)}
                {aberta.abertaPor ? ` por ${aberta.abertaPor}` : ''} ·{' '}
                <b style={{ color: 'var(--text-primary)' }}>
                  {pendentes ? `${pendentes} de ${aberta.itens.length} ${pendentes === 1 ? 'item pendente' : 'itens pendentes'}` : 'checklist completo'}
                </b>
              </>
            ) : status === 'recuperado' ? (
              'O carro voltou da rescisão. Libere para venda para abrir o checklist; quando tudo estiver feito, ele fica Disponível.'
            ) : status === 'disponivel' ? (
              'Pronto para venda. Se precisar de oficina, documento ou manutenção, envie para preparação.'
            ) : (
              'Sem preparação aberta.'
            )}
          </div>
          {aberta?.oQueFalta && <div className="mt-[2px] text-[12px]" style={{ color: 'var(--text-muted)' }}>O que falta: {aberta.oQueFalta}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          {podeLiberar && <Botao variante="primaria" onClick={() => setAbrir('liberar')}>Liberar para venda</Botao>}
          {podeEnviar && <Botao variante="secundaria" onClick={() => setAbrir('enviar')}>Enviar para preparação</Botao>}
          {aberta && podeOperar && (
            <Botao
              variante="primaria"
              carregando={ocupado}
              disabled={pendentes > 0}
              title={pendentes > 0 ? 'Marque todos os itens como feitos ou "não se aplica" antes' : undefined}
              onClick={() => void rodar(() => ativoService.concluirPreparacao(ativoId), 'Veículo pronto para venda.')}
            >
              Marcar como pronto
            </Botao>
          )}
        </div>
      </div>
      {aberta && podeOperar && pendentes > 0 && (
        <div className="px-[18px] pb-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          "Marcar como pronto" libera quando todos os itens estiverem feitos ou marcados como "não se aplica".
        </div>
      )}

      {aberta && (
        <>
          {aberta.itens.map((i) => (
            <LinhaItem
              key={i.id}
              item={i}
              podeOperar={podeOperar}
              ocupado={ocupado}
              onMarcar={(s) => void rodar(() => ativoService.marcarItemPreparacao(i.id, s))}
              onRemover={() => void rodar(() => ativoService.removerItemPreparacao(i.id), 'Item removido.')}
            />
          ))}
          {podeOperar && (
            <div className="flex flex-wrap items-center gap-[8px] px-[18px] py-[10px]" style={{ borderTop: '1px solid var(--border-light)' }}>
              <input
                value={novoItem}
                onChange={(e) => setNovoItem(e.target.value)}
                maxLength={120}
                placeholder="Incluir item só para este carro (ex.: trocar pneu dianteiro)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && novoItem.trim()) void rodar(async () => { await ativoService.incluirItemPreparacao(ativoId, novoItem.trim()); setNovoItem(''); });
                }}
                className="h-[32px] min-w-0 flex-[1_1_260px] rounded-[8px] px-[10px] text-[12.5px]"
                style={inStyle}
              />
              <Botao
                variante="secundaria"
                tamanho="sm"
                disabled={ocupado || !novoItem.trim()}
                onClick={() => void rodar(async () => { await ativoService.incluirItemPreparacao(ativoId, novoItem.trim()); setNovoItem(''); })}
              >
                + Incluir item
              </Botao>
            </div>
          )}
        </>
      )}

      <Historico anteriores={anteriores} />

      {abrir && (
        <ModalAbrir
          titulo={abrir === 'liberar' ? 'Liberar para venda' : 'Enviar para preparação'}
          explicacao={
            abrir === 'liberar'
              ? 'O carro passa de Recuperado para Em preparação, com o checklist. Ele já pode ser simulado e proposto (com o alerta), mas o contrato só é gerado depois de marcado como pronto.'
              : 'O carro passa de Disponível para Em preparação, com o checklist. Ele continua aparecendo na simulação com o alerta, e o contrato só é gerado depois de marcado como pronto.'
          }
          onFechar={() => setAbrir(null)}
          onConfirmar={async (texto) => {
            await (abrir === 'liberar' ? ativoService.liberarParaVenda(ativoId, texto) : ativoService.enviarParaPreparacao(ativoId, texto));
            await onMudou();
            toast.sucesso('Veículo em preparação.');
          }}
        />
      )}
    </section>
  );
}
