import type { ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { AreaRota, tituloSemArea, useTemArea } from '../lib/permissoes';

// Link GENÉRICO entre áreas (doc 06 §5.4 item 3): se o usuário tem a área de
// destino, é um <Link> normal; se não tem, vira texto desabilitado com o motivo no
// título — em vez de abrir a tela e cair em "Sem acesso". Sem `area`, é só um Link.
export function LinkArea({ area, ...props }: ComponentProps<typeof Link> & { area?: AreaRota }) {
  const tem = useTemArea(area ?? []);
  if (!area || tem) return <Link {...props} />;
  const { className, style, children } = props;
  return (
    <span
      aria-disabled="true"
      title={tituloSemArea(area)}
      className={className}
      style={{ ...(style as object), opacity: 0.5, cursor: 'not-allowed', textDecoration: 'none' }}
    >
      {children}
    </span>
  );
}
