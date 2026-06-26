// Validação de documentos brasileiros (CPF/CNPJ) por dígito verificador.
// Funções puras — Doc 7 item 2.1 ("validação de documento"). Sem rede, sem estado.

/** Remove tudo que não for dígito (máscara, espaços). "123.456.789-00" -> "12345678900". */
export function limparDocumento(doc: string): string {
  return (doc ?? '').replace(/\D/g, '');
}

/** Valida CPF pelos dois dígitos verificadores. Rejeita sequências repetidas (111...). */
export function validarCPF(cpf: string): boolean {
  const d = limparDocumento(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * (ate + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** Valida CNPJ pelos dois dígitos verificadores. Rejeita sequências repetidas. */
export function validarCNPJ(cnpj: string): boolean {
  const d = limparDocumento(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digito = (ate: number): number => {
    // Pesos cíclicos do CNPJ: 5..2 depois 9..2 (ou 6..2 / 9..2 para o segundo dígito).
    let peso = ate - 7;
    let soma = 0;
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

/**
 * Valida CPF ou CNPJ inferindo pelo comprimento (11 -> CPF, 14 -> CNPJ).
 * Passe `tipo` para exigir um formato específico (PF/PJ).
 */
export function validarDocumento(
  doc: string,
  tipo?: 'pf' | 'pj',
): boolean {
  const d = limparDocumento(doc);
  if (tipo === 'pf') return validarCPF(d);
  if (tipo === 'pj') return validarCNPJ(d);
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return false;
}
