import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Botao, type VarianteBotao } from './Botao';

// Confirmação GENÉRICA (layout v2, doc 03 §5.8 / §11): pergunta curta antes de
// uma ação que não se desfaz com um clique (bloquear veículo, remover,
// repetir consulta paga). Substitui o window.confirm — mesmo desenho nos dois
// temas, no celular e com o texto do botão dizendo O QUE vai acontecer.
// A página só passa a pergunta e o verbo; nunca desenha o diálogo à mão.
export function ModalConfirmacao({
  open,
  titulo,
  children,
  confirmar,
  cancelar = 'Cancelar',
  variante = 'perigo',
  carregando = false,
  onConfirmar,
  onCancelar,
}: {
  open: boolean;
  titulo: string;
  children: ReactNode; // a pergunta e o contexto (quem, o quê)
  confirmar: string; // verbo da ação, ex.: "Bloquear veículo"
  cancelar?: string;
  variante?: VarianteBotao; // perigo (padrão) ou primaria para ações não destrutivas
  carregando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancelar} title={titulo} largura={420}>
      <div className="flex flex-col gap-[14px]">
        <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>{children}</div>
        <div className="flex flex-col-reverse gap-[8px] sm:flex-row sm:justify-end">
          <Botao variante="secundaria" onClick={onCancelar} disabled={carregando}>
            {cancelar}
          </Botao>
          <Botao variante={variante} onClick={onConfirmar} carregando={carregando} autoFocus>
            {confirmar}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
