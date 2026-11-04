import { StatusProposta } from '@prisma/client';

// STATUS DA PROPOSTA É DERIVADO DOS FATOS (decisão Luís 04/11/2026, caso Arlindo:
// proposta com documentos completos e alçada aprovada seguia "Pendente" e a
// coluna "Em análise" vivia em zero). O campo gravado era escrito em NOVE pontos
// de cinco módulos, e cada fluxo tinha de lembrar de atualizá-lo — o "Abrir
// análise" da página da proposta e o "Próximo: Análise" nunca lembraram.
//
// Regra 16 aplicada ao status: UMA função decide o status a partir dos fatos
// (análise de cadastro, parecer, contrato gerado); os fluxos só produzem fatos
// e chamam PropostaStatusService.sincronizar(). A varredura (subida + diária)
// corrige divergência e a registra na auditoria — divergência corrigida é
// sinal de fluxo gravando status por fora.
export interface FatosProposta {
  statusGravado: StatusProposta;
  contratoGeradoId: string | null;
  analise: { status: string } | null;
  parecer: { resultado: string } | null;
}

const FAMILIA_APROVADA: StatusProposta[] = ['APROVADA', 'EM_FORMALIZACAO'];

export function derivarStatusProposta(f: FatosProposta): StatusProposta {
  // 1. Cancelar é EVENTO (operador, kanban, análise encerrada) — fato nenhum o desfaz.
  if (f.statusGravado === 'CANCELADA') return 'CANCELADA';
  // 2. Contrato gerado = convertida (doc 02 §4-A.4).
  if (f.contratoGeradoId) return 'CONVERTIDA';
  // "Em formalização" é um passo dentro da família aprovada (contrato cancelado
  // para reformalizar): quando os fatos dizem "aprovada", o passo gravado fica.
  const aprovada = (): StatusProposta => (FAMILIA_APROVADA.includes(f.statusGravado) ? f.statusGravado : 'APROVADA');
  // 3. Análise de cadastro aberta manda (trilha única, doc 02 §14).
  if (f.analise) {
    switch (f.analise.status) {
      case 'PROPOSTA_ENCERRADA':
        return 'CANCELADA';
      case 'NAO_APROVADO':
        return 'REPROVADA';
      case 'LIBERADO_PARA_FORMALIZACAO':
        return aprovada();
      default:
        return 'EM_ANALISE';
    }
  }
  // 4. Parecer legado (proposta sem análise de cadastro aberta).
  if (f.parecer) return f.parecer.resultado === 'REPROVADO' ? 'REPROVADA' : aprovada();
  // 5. Sem fato que decida: o gravado fica (reprova da Camada 1, "Em análise"
  //    arrastado no kanban, dado anterior a esta regra).
  return f.statusGravado;
}
