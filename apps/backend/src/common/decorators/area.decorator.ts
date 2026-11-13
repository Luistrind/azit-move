import { SetMetadata } from '@nestjs/common';
import { AreaSistema } from '@prisma/client';

// Área(s) de trabalho a que a rota pertence (doc 06 §7.5). Na classe vale para
// todos os métodos; no método, sobrepõe a classe. Com mais de uma área basta o
// usuário ter UMA (leitura compartilhada); a PRIMEIRA listada é a área dona, e é
// ela que vai no campo `area` do 403.
export const AREA_KEY = 'area';
export const Area = (...areas: AreaSistema[]) => SetMetadata(AREA_KEY, areas);

// Exceção declarada: rota de apoio a qualquer usuário autenticado (sessão, sino,
// Início, preferências). A justificativa é obrigatória e fica no código.
export const AREA_LIVRE_KEY = 'areaLivre';
export const AreaLivre = (justificativa: string) => SetMetadata(AREA_LIVRE_KEY, justificativa);

// Telas compartilhadas (doc 06 §13, regra de desempate): a leitura lista todas as
// áreas que a consomem; a primeira é a dona. Definidas UMA vez para não divergirem
// entre controllers — o router do frontend declara os mesmos conjuntos nas rotas
// /contratos/:id e /titulares/:id.
//
// Detalhe do contrato: não há item de menu "Contratos"; a tela é aberta a partir da
// carteira (régua, acordos, clientes), da proposta formalizada (funil) e da ficha.
export const AREAS_CONTRATO: AreaSistema[] = [
  AreaSistema.CONTRATOS,
  AreaSistema.CARTEIRA_COBRANCA,
  AreaSistema.COMERCIAL,
];
// Ficha do titular (hub da conta): Pessoas administra, o atendimento cria e lê
// (doc 06 §13, linha `titular`). Carteira → ficha é link entre áreas.
export const AREAS_FICHA_TITULAR: AreaSistema[] = [AreaSistema.PESSOAS, AreaSistema.COMERCIAL];
