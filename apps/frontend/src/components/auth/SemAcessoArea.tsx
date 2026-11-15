import { Link } from 'react-router-dom';
import { nomeArea } from '@azit/types';
import { Botao } from '../Botao';

// Página "Sem acesso a esta área" (doc 06 §5.4 item 3). Aparece quando a rota
// declara uma área que o usuário não tem — por link digitado, favorito antigo ou
// link de outra tela. Nome da área por extenso, caminho de volta e o que fazer.
export function SemAcessoArea({ area }: { area: string }) {
  return (
    <div className="flex flex-col items-start gap-[10px] p-[24px]">
      <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Sem acesso a esta área</h1>
      <p className="text-[13px]" style={{ color: 'var(--text-body)' }}>
        Esta tela pertence à área <b>{nomeArea(area)}</b>, que não está entre as suas áreas de trabalho.
      </p>
      <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
        Se você precisa dela, peça ao administrador: a área é concedida em Configuração › Usuários e permissões.
      </p>
      <Link to="/">
        <Botao variante="primaria">Voltar ao Início</Botao>
      </Link>
    </div>
  );
}
