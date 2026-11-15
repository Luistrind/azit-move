import type { ComponentProps } from 'react';
import { Botao } from './Botao';
import { AreaRota, tituloSemArea, useTemArea } from '../lib/permissoes';

// Botão GENÉRICO que leva a outra área (doc 06 §5.4 item 3): sem a área de
// destino, aparece desabilitado com o motivo no título, em vez de abrir a tela e
// cair em "Sem acesso". Demais props são as do Botao.
export function BotaoArea({ area, disabled, title, ...props }: ComponentProps<typeof Botao> & { area: AreaRota }) {
  const tem = useTemArea(area);
  return <Botao {...props} disabled={disabled || !tem} title={tem ? title : tituloSemArea(area)} />;
}
