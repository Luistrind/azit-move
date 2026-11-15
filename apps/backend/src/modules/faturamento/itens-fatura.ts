import { Prisma } from '@prisma/client';
import { chaveProdutoItemFatura, grupoCascataDoItem, type GrupoCascata, type TipoContrato } from '@azit/utils';

// Itens da fatura como o CLIENTE e o OPERADOR leem (doc 02 §32.3) — UMA montagem
// para a página pública, o PDF, "o que este valor quitou" e a ficha do titular
// (§32.2: "o mesmo nome de item vale na lista, no detalhe do pagamento e no
// PDF"). A classificação é a da carteira (`chaveProdutoItemFatura`, Regra 16);
// o grupo da cascata (§32.5) sai dela.

// Include único dos itens com o que a apresentação e o motor precisam.
export const INCLUDE_ITEM_FATURA = {
  parcela: {
    include: {
      itemContratado: {
        include: {
          contrato: {
            select: {
              id: true,
              numero: true,
              snapshotJson: true,
              taxaMultaAtraso: true,
              taxaJurosAtraso: true,
              ativo: { select: { tipo: true, descricao: true, marca: true, modelo: true, placa: true } },
              novacaoComoTermo: { select: { id: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ItemFaturaInclude;

export type ItemFaturaCarregado = Prisma.ItemFaturaGetPayload<{ include: typeof INCLUDE_ITEM_FATURA }>;
export type ContratoDoItem = NonNullable<ItemFaturaCarregado['parcela']>['itemContratado']['contrato'];

export interface ItemFaturaApresentado {
  id: string;
  titulo: string; // "Compra Parcelada — Hyundai HB20S"
  subtitulo: string | null; // "Parcela 23 de 104"
  produto: string; // chave do produto (compra_parcelada, protecao_veicular, …)
  grupo: GrupoCascata; // grupo da cascata de baixa (§32.5)
  valor: number; // centavos
  parcelaId: string | null;
  contratoId: string | null;
}

const cent = (d: Prisma.Decimal): number => Math.round(Number(d.toString()) * 100);

// Contratos distintos envolvidos nos itens (para `tiposDosContratos`).
export function contratosDosItens(itens: ItemFaturaCarregado[]): Map<string, ContratoDoItem> {
  const contratos = new Map<string, ContratoDoItem>();
  for (const it of itens) {
    const c = it.parcela?.itemContratado.contrato;
    if (c && !contratos.has(c.id)) contratos.set(c.id, c);
  }
  return contratos;
}

export function apresentarItemFatura(it: ItemFaturaCarregado, tipos: Map<string, TipoContrato>): ItemFaturaApresentado {
  const contrato = it.parcela?.itemContratado.contrato ?? null;
  const tipoContrato = contrato ? (tipos.get(contrato.id) ?? null) : null;
  const chave = chaveProdutoItemFatura({
    tipo: it.tipo,
    descricao: it.descricao,
    valor: cent(it.valor),
    origemItem: it.parcela?.itemContratado.origem ?? null,
    tipoContrato,
  });
  const ativo = contrato?.ativo ?? null;
  const nomeVeiculo = ativo ? [ativo.marca, ativo.modelo].filter(Boolean).join(' ').trim() || ativo.descricao : null;
  const parcelaDe = it.parcela ? `Parcela ${it.parcela.numero} de ${it.parcela.totalParcelas}` : null;
  const objeto = it.parcela?.itemContratado.descricao ?? it.descricao;
  let titulo = chave.rotulo;
  let subtitulo: string | null = parcelaDe;
  if (chave.chave === 'encargos') {
    titulo = 'Encargos de atraso';
    subtitulo = it.descricao;
  } else if (chave.parte === 'acordo') {
    titulo = 'Acordo de pagamento';
    subtitulo = parcelaDe ?? it.descricao;
  } else if (chave.parte === 'intermediaria') {
    titulo = nomeVeiculo ? `${chave.rotulo} — ${nomeVeiculo}` : chave.rotulo;
    subtitulo = 'Entrada — parcela intermediária';
  } else if (chave.parte === 'entrada_contrato' || chave.parte === 'entrada_acordo') {
    titulo = nomeVeiculo ? `${chave.rotulo} — ${nomeVeiculo}` : chave.rotulo;
    subtitulo = 'Entrada';
  } else if (chave.parte === 'avulso') {
    // Serviço/lançamento avulso dentro do produto do contrato: a descrição é o que explica.
    titulo = it.descricao;
    subtitulo = chave.rotulo;
  } else if (chave.chave === 'compra_parcelada') {
    titulo = nomeVeiculo ? `Compra Parcelada — ${nomeVeiculo}` : 'Compra Parcelada';
  } else if (chave.chave === 'reembolso_parcelado' || chave.chave === 'credito_avulso' || chave.chave === 'termo_novacao') {
    titulo = `${chave.rotulo} — ${objeto}`;
  } else if (chave.chave === 'protecao_veicular') {
    titulo = 'Proteção veicular';
    subtitulo = nomeVeiculo ? `Serviço do período · ${nomeVeiculo}` : 'Serviço do período';
  } else {
    // Outros serviços do Catálogo (taxa, clube): nome do produto; descrição como apoio.
    subtitulo = it.descricao !== chave.rotulo ? it.descricao : null;
  }
  return {
    id: it.id,
    titulo,
    subtitulo,
    produto: chave.chave,
    grupo: grupoCascataDoItem(chave),
    valor: cent(it.valor),
    parcelaId: it.parcelaId,
    contratoId: contrato?.id ?? null,
  };
}
