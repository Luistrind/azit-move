import { TipoPessoa, StatusTitular } from '../enums/titular';

// Titular — cadastro único de pessoa (Doc 2 §4.1).
// "Cliente" e "investidor" são papéis derivados do que a conta possui, não campos aqui.
export interface Titular {
  id: string;
  nome: string;
  tipoPessoa: TipoPessoa;
  cpfCnpj: string;
  rg?: string | null;
  estadoCivil?: string | null;
  profissao?: string | null;
  whatsapp: string;
  email?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  asaasCustomerId?: string | null;
  status: StatusTitular;
  createdAt: string;
  updatedAt: string;
}

export interface IntervenienteGarantidor {
  id: string;
  titularId: string;
  nome: string;
  cpf: string;
  rg?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}
