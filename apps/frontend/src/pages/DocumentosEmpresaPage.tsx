import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dossieService } from '../services/dossie.service';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';
import { instanteBR } from '../lib/datas';

// Configuração → Documentos da empresa (doc 02 §30): o contrato social da Azit
// que entra em todo dossiê para cobrança judicial. Escrita só ADMIN/DIRETOR.

const card = 'rounded-card p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

export function DocumentosEmpresaPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(['ADMIN', 'DIRETOR']);
  const q = useQuery({ queryKey: ['empresa-parametros'], queryFn: () => dossieService.parametrosEmpresa() });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const atual = q.data?.contratoSocial ?? null;

  async function salvar() {
    if (!arquivo) { toast.erro('Escolha o PDF do contrato social.'); return; }
    setSalvando(true);
    try {
      await dossieService.salvarContratoSocial(arquivo, descricao.trim());
      await qc.invalidateQueries({ queryKey: ['empresa-parametros'] });
      setArquivo(null);
      setDescricao('');
      toast.sucesso('Contrato social atualizado.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Documentos da empresa</h1>
        <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Documentos da Azit que o sistema anexa automaticamente — hoje, o contrato social que vai em todo dossiê para cobrança judicial.</p>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Contrato social" acao={atual ? <Botao variante="secundaria" tamanho="sm" onClick={() => void dossieService.abrirContratoSocial()}>Abrir PDF atual</Botao> : undefined}>
          {q.isLoading ? (
            <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          ) : atual ? (
            <div className="mb-[12px] text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
              Atual: <b style={{ color: 'var(--text-primary)' }}>{atual.nome}</b>{atual.descricao ? ` · ${atual.descricao}` : ''}{atual.em ? ` · anexado em ${instanteBR(atual.em)}` : ''}.
            </div>
          ) : (
            <div className="mb-[12px] rounded-[10px] px-[12px] py-[8px] text-[12.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
              Nenhum contrato social anexado — os dossiês saem sem essa seção até você anexar aqui.
            </div>
          )}
          {podeEditar ? (
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="flex flex-col gap-[4px]">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>PDF (última alteração contratual consolidada)</label>
                <input type="file" accept="application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-[12px]" />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Descrição (vai na capa do anexo)</label>
                <input className={inputCls} style={inputStyle} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex: Alteração contratual de 30/12/2025" />
              </div>
              <Botao variante="primaria" onClick={() => void salvar()} carregando={salvando} disabled={!arquivo}>{atual ? 'Substituir' : 'Anexar'}</Botao>
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Só administrador ou diretoria substitui o documento.</div>
          )}
        </Secao>
      </div>
    </div>
  );
}
