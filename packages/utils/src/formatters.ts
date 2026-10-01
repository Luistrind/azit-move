import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { centavosParaReais } from './money';

/** Formata um valor em CENTAVOS inteiros como moeda BRL (ex: 99700 -> "R$ 997,00"). */
export function formatCurrency(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(centavosParaReais(centavos));
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR });
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
