// Busca de endereço por CEP (ViaCEP — API pública). Sem auth; chamada direta do
// browser. Retorna null se o CEP for inválido/não encontrado.
export interface EnderecoCep {
  endereco: string; // logradouro
  bairro: string;
  cidade: string;
  estado: string; // UF
}

export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const limpo = cep.replace(/\D/g, '');
  if (limpo.length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    if (!resp.ok) return null;
    const d = await resp.json();
    if (d.erro) return null;
    return {
      endereco: d.logradouro ?? '',
      bairro: d.bairro ?? '',
      cidade: d.localidade ?? '',
      estado: d.uf ?? '',
    };
  } catch {
    return null;
  }
}
