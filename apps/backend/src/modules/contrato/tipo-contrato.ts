import { classificarContrato, TipoContrato } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

// Tipo DERIVADO do ContratoCredito no backend (doc 02 §5.2, decisão Luís
// 29/10/2026). A regra mora em @azit/utils (`classificarContrato`, Regra 16);
// aqui só se carregam as marcas que vivem em outras tabelas:
//   • Aprovacao tipoOperacao 'reembolso_parcelado' → RP nativo (§18.5);
//   • Novacao.contratoTermoId → Termo de novação (§7.7b).
// Quem precisar do tipo de N contratos seleciona com `SELECT_TIPO_CONTRATO`
// e chama `tiposDosContratos` — Carteira (KPIs e posição por titular) usa; a
// ficha do titular e relatórios devem reutilizar, nunca copiar os critérios.

export const SELECT_TIPO_CONTRATO = {
  id: true,
  numero: true,
  snapshotJson: true,
  ativo: { select: { tipo: true } },
  novacaoComoTermo: { select: { id: true } },
} as const;

export interface ContratoComMarcas {
  id: string;
  numero: string;
  snapshotJson: unknown;
  ativo: { tipo: string } | null;
  novacaoComoTermo: { id: string } | null;
}

type Db = Pick<PrismaService['db'], 'aprovacao'>;

export async function tiposDosContratos(db: Db, contratos: ContratoComMarcas[]): Promise<Map<string, TipoContrato>> {
  const tipos = new Map<string, TipoContrato>();
  if (contratos.length === 0) return tipos;
  // Só os contratos sem ativo podem ser RP nativo — poupa a consulta quando a
  // carteira é só de veículos.
  const candidatos = contratos.filter((c) => !c.ativo).map((c) => c.id);
  const aprovados = candidatos.length
    ? await db.aprovacao.findMany({
        where: { referenciaTipo: 'contrato_credito', tipoOperacao: 'reembolso_parcelado', referenciaId: { in: candidatos } },
        select: { referenciaId: true },
      })
    : [];
  const comAprovacaoRp = new Set(aprovados.map((a) => a.referenciaId));
  for (const c of contratos) {
    tipos.set(
      c.id,
      classificarContrato({
        numero: c.numero,
        ativo: c.ativo,
        snapshotJson: c.snapshotJson,
        aprovadoComoReembolso: comAprovacaoRp.has(c.id),
        termoDeNovacao: c.novacaoComoTermo !== null,
      }),
    );
  }
  return tipos;
}
