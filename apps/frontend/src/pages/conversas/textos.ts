import { formatCurrency, isoParaBR, primeiroNome } from '@azit/utils';
import type { DocumentoSimulacaoEnvio } from '../../services/conversas.service';

// "Mandar ao cliente" (doc 02 §34.7): o texto e as linhas do PDF são montados
// com os valores que o serviço da simulação devolveu — aqui só se FORMATA,
// nenhuma conta (Regra 16). Vocabulário do produto: compra parcelada, entrada,
// parcela, desconto por antecipar; nunca "financiamento", "taxa" ou "juros".

export interface Mensagem {
  titulo: string; // título da janela de envio e do PDF
  texto: string; // com *negrito* do WhatsApp
  pdf: DocumentoSimulacaoEnvio;
}

const POR: Record<string, string> = { semanal: 'por semana', quinzenal: 'por quinzena', mensal: 'por mês' };
export const porFrequencia = (f: string) => POR[f] ?? '';
const dia = (iso: string | null | undefined) => (iso ? isoParaBR(iso.slice(0, 10)) : '');
const ola = (nome: string | null | undefined) => {
  const n = primeiroNome(nome ?? '');
  return n ? `Olá, ${n}!` : 'Olá!';
};

export function textoCompra(p: {
  nome: string | null;
  veiculo: string;
  valorAvista: number;
  valorEntrada: number;
  valorParcela: number;
  frequencia: string;
  prazoMeses: number | null;
  validaAte: string | null;
}): Mensagem {
  const parcela = `${formatCurrency(p.valorParcela)} ${porFrequencia(p.frequencia)}`;
  const prazo = p.prazoMeses ? `em ${p.prazoMeses} meses` : '';
  const linhas = [
    `${ola(p.nome)} Segue a simulação da Azit Move:`,
    '',
    `*${p.veiculo}*`,
    `Valor à vista: ${formatCurrency(p.valorAvista)}`,
    `Entrada: *${formatCurrency(p.valorEntrada)}*`,
    `Parcela: *${parcela}*${prazo ? `, ${prazo}` : ''}`,
    '',
    p.validaAte ? `Condição válida até ${dia(p.validaAte)}. Quer seguir? Eu te passo a lista de documentos.` : 'Quer seguir? Eu te passo a lista de documentos.',
  ];
  return {
    titulo: `Simulação · ${p.veiculo}`,
    texto: linhas.join('\n'),
    pdf: {
      titulo: `Simulação · ${p.veiculo}`,
      destaque: { rotulo: 'Parcela', valor: parcela },
      linhas: [
        { rotulo: 'Veículo', valor: p.veiculo },
        { rotulo: 'Valor à vista', valor: formatCurrency(p.valorAvista) },
        { rotulo: 'Entrada', valor: formatCurrency(p.valorEntrada) },
        ...(p.prazoMeses ? [{ rotulo: 'Prazo', valor: `${p.prazoMeses} meses` }] : []),
      ],
      observacoes: [
        ...(p.validaAte ? [`Condição válida até ${dia(p.validaAte)}.`] : []),
        'A compra depende da análise de cadastro.',
      ],
    },
  };
}

export function textoAcordo(p: {
  nome: string | null;
  saldo: number;
  faturas: number;
  valorEntrada: number;
  dataLimiteEntrada: string | null;
  numeroParcelas: number;
  valorParcela: number;
  frequencia: string;
  faturaDurante: number | null;
}): Mensagem {
  const linhas = [
    `${ola(p.nome)} Montei uma proposta para regularizar ${p.faturas === 1 ? 'a fatura em atraso' : `as ${p.faturas} faturas em atraso`} (${formatCurrency(p.saldo)} hoje):`,
    '',
    `Entrada: *${formatCurrency(p.valorEntrada)}*${p.dataLimiteEntrada ? ` até ${dia(p.dataLimiteEntrada)}` : ''}`,
    `Depois: *${p.numeroParcelas} parcelas de ${formatCurrency(p.valorParcela)}*, junto da sua fatura`,
    ...(p.faturaDurante ? [`Sua fatura ${porFrequencia(p.frequencia).replace('por ', 'da ')} durante o acordo: ${formatCurrency(p.faturaDurante)}`] : []),
    '',
    'Se estiver de acordo, me responda "de acordo" que eu preparo a entrada.',
  ];
  return {
    titulo: 'Proposta de acordo',
    texto: linhas.join('\n'),
    pdf: {
      titulo: 'Proposta de acordo',
      destaque: { rotulo: 'Parcela do acordo', valor: `${p.numeroParcelas} × ${formatCurrency(p.valorParcela)}` },
      linhas: [
        { rotulo: 'Faturas em atraso, valor de hoje', valor: formatCurrency(p.saldo) },
        { rotulo: 'Entrada', valor: formatCurrency(p.valorEntrada) },
        ...(p.dataLimiteEntrada ? [{ rotulo: 'Pagar a entrada até', valor: dia(p.dataLimiteEntrada) }] : []),
        ...(p.faturaDurante ? [{ rotulo: 'Fatura durante o acordo', valor: formatCurrency(p.faturaDurante) }] : []),
      ],
      observacoes: ['Proposta sujeita à aprovação da Azit Move.'],
    },
  };
}

export function textoNovacao(p: { nome: string | null; prazoMeses: number | null; numeroParcelas: number; valorParcela: number; frequencia: string; primeiraEm: string }): Mensagem {
  const parcela = `${formatCurrency(p.valorParcela)} ${porFrequencia(p.frequencia)}`;
  const linhas = [
    `${ola(p.nome)} Uma opção é refazer o plano do seu carro${p.prazoMeses ? ` em ${p.prazoMeses} meses` : ''}.`,
    '',
    `Parcela nova: *${parcela}*`,
    `Primeira parcela em ${dia(p.primeiraEm)}`,
    '',
    'Quer que eu prepare a proposta?',
  ];
  return {
    titulo: 'Proposta de novo plano',
    texto: linhas.join('\n'),
    pdf: {
      titulo: 'Proposta de novo plano',
      destaque: { rotulo: 'Parcela nova', valor: parcela },
      linhas: [
        ...(p.prazoMeses ? [{ rotulo: 'Prazo', valor: `${p.prazoMeses} meses` }] : []),
        { rotulo: 'Parcelas', valor: String(p.numeroParcelas) },
        { rotulo: 'Primeira parcela', valor: dia(p.primeiraEm) },
      ],
      observacoes: ['O contrato atual é encerrado e nasce um novo. Proposta sujeita à aprovação da Azit Move.'],
    },
  };
}

export function textoQuitacao(p: { nome: string | null; contrato: string; valorFace: number; desconto: number; valorQuitacao: number; hoje: string }): Mensagem {
  const linhas = [
    `${ola(p.nome)} Para quitar seu contrato hoje o valor é *${formatCurrency(p.valorQuitacao)}*.`,
    p.desconto > 0 ? `Já está com ${formatCurrency(p.desconto)} de desconto por antecipar as parcelas que ainda vão vencer.` : '',
    `Esse valor vale para pagamento hoje (${dia(p.hoje)}).`,
  ].filter(Boolean);
  return {
    titulo: 'Valor para quitar o contrato',
    texto: linhas.join('\n'),
    pdf: {
      titulo: 'Valor para quitar o contrato',
      destaque: { rotulo: 'Para quitar hoje', valor: formatCurrency(p.valorQuitacao) },
      linhas: [
        { rotulo: 'Contrato', valor: p.contrato },
        { rotulo: 'Parcelas em aberto (valor de face)', valor: formatCurrency(p.valorFace) },
        { rotulo: 'Desconto por antecipar', valor: formatCurrency(p.desconto) },
      ],
      observacoes: [`Valor para pagamento em ${dia(p.hoje)}.`],
    },
  };
}

