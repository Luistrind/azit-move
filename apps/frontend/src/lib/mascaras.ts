// Máscaras brasileiras de digitação (proposta UX, padrão P5 — componente único).
// Todas recebem o texto cru do input e devolvem o texto formatado.

export function mascararCpf(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

export function mascararCpfCnpj(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) return mascararCpf(d);
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

export function mascararCep(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

export function mascararPlaca(valor: string): string {
  return valor
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 7);
}

// Dinheiro por dígitos: o usuário digita números e o campo mostra "1.990,00".
export function mascararDinheiro(valor: string): string {
  const d = valor.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!d) return '';
  const centavos = Number(d);
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Centavos a partir do texto mascarado por mascararDinheiro.
export function dinheiroParaCentavos(texto: string): number {
  const d = texto.replace(/\D/g, '');
  return d ? Number(d) : 0;
}

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}
