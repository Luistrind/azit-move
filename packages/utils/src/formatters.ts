import { centavosParaReais } from './money';
import { formatarDiaBR, isoParaBR } from './datas';

/** Formata um valor em CENTAVOS inteiros como moeda BRL (ex: 99700 -> "R$ 997,00"). */
export function formatCurrency(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(centavosParaReais(centavos));
}

/** 'DD/MM/YYYY' de uma coluna de DATA (dia-calendário gravado em UTC) ou de um 'YYYY-MM-DD'. */
export function formatDate(date: Date | string): string {
  return typeof date === 'string' ? isoParaBR(date) : formatarDiaBR(date);
}

export function formatCPF(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function formatCNPJ(cnpj: string): string {
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

/** Placa Mercosul ou antiga: "SJC9I93" -> "SJC-9I93". */
export function formatPlaca(placa: string): string {
  const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : placa;
}

/** Formato de exibição de parcela: número/total (ex: "14/157"). */
export function formatParcela(atual: number, total: number): string {
  return `${atual}/${total}`;
}

// Rótulo do veículo com a placa (decisão Luís 01/10): a proposta e o contrato
// são de um carro ESPECÍFICO — onde o carro aparecer, a placa vai junto.
// "Hyundai HB20s 2024 · SIV8C81"; sem placa, só a descrição.
export function rotuloAtivo(a: { descricao: string; placa?: string | null }): string {
  return a.placa ? `${a.descricao} · ${a.placa}` : a.descricao;
}

// Veículo de referência (doc 02 §31.1): descrição com preço FIPE, sem ativo.
export function rotuloReferencia(r: { marca: string; modelo: string; anoModelo: number }): string {
  return `${r.marca} ${r.modelo} ${r.anoModelo} · referência FIPE`;
}

// Proposta tem ativo OU referência (doc 02 §31) — um rótulo só para as telas.
export function rotuloVeiculoProposta(p: {
  ativo?: { descricao: string; placa?: string | null } | null;
  referencia?: { marca: string; modelo: string; anoModelo: number } | null;
}): string {
  if (p.ativo) return rotuloAtivo(p.ativo);
  if (p.referencia) return rotuloReferencia(p.referencia);
  return 'Sem veículo';
}

/**
 * CPF/CNPJ mascarado para páginas PÚBLICAS (Fatura Azit, doc 02 §32.2, decisão
 * 11/11): só o miolo aparece — CPF "***.456.789-**", CNPJ "**.345.678/0001-**".
 * Qualquer outro tamanho vira só asteriscos.
 */
export function mascararDocumento(doc: string): string {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return '***';
}

/** Primeiro nome, com inicial maiúscula, para saudação ("Olá, Carlos"). */
export function primeiroNome(nome: string): string {
  const n = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}
