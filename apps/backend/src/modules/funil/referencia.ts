import { VeiculoReferencia } from '@prisma/client';
import { rotuloReferencia } from '@azit/utils';

// Veículo de referência na borda da API (doc 02 §29.1): valor em centavos,
// datas ISO e o rótulo único das telas.
export interface ReferenciaApi {
  id: string;
  marca: string;
  modelo: string;
  anoModelo: number;
  combustivel: string | null;
  fipeCodigo: string | null;
  valorFipe: number; // centavos
  fipeReferencia: string;
  consultadoEm: string;
  rotulo: string;
}

export function referenciaParaApi(r: VeiculoReferencia): ReferenciaApi {
  return {
    id: r.id,
    marca: r.marca,
    modelo: r.modelo,
    anoModelo: r.anoModelo,
    combustivel: r.combustivel,
    fipeCodigo: r.fipeCodigo,
    valorFipe: Math.round(Number(r.valorFipe.toString()) * 100),
    fipeReferencia: r.fipeReferencia,
    consultadoEm: r.consultadoEm.toISOString(),
    rotulo: rotuloReferencia(r),
  };
}
