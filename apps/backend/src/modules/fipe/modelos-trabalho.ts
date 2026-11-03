// Modelos de TRABALHO para o veículo de referência (decisão Luís 03/11/2026):
// a lista completa da FIPE é longa demais para o balcão, e a mesma versão de
// entrada muda de nome na Fundação conforme o ano (o HB20 "Comfort" de 2023+
// era "Sense" em 2020–22 e "Comf./C.Plus" até 2019). Cada modelo aqui junta as
// versões de ENTRADA, manuais, em ordem de preferência; os anos são a união.
//
// Placeholder marcado (Regra 12): lista fixa, editável só aqui. Quando houver
// mais modelos na operação, acrescentar a linha — nada muda no fluxo.
export interface ModeloTrabalho {
  chave: string;
  rotulo: string; // como a operação chama
  detalhe: string; // versões que a FIPE usa ao longo dos anos
  codigoMarca: string;
  versoes: string[]; // códigos de modelo FIPE, do mais recente ao mais antigo
}

export const MODELOS_TRABALHO: ModeloTrabalho[] = [
  {
    chave: 'hb20s',
    rotulo: 'Hyundai HB20S 1.0 manual',
    detalhe: 'Comfort · Vision (2020–22) · C.Plus/C.Style (até 2019)',
    codigoMarca: '26',
    versoes: ['10012', '10820', '8858', '6434'],
  },
  {
    chave: 'hb20',
    rotulo: 'Hyundai HB20 1.0 manual',
    detalhe: 'Comfort · Sense (2020–22) · Comf./C.Plus (até 2019)',
    codigoMarca: '26',
    versoes: ['9906', '10861', '8854', '6205'],
  },
  {
    chave: 'mobi',
    rotulo: 'Fiat Mobi 1.0',
    detalhe: 'Like · Easy (2017–22)',
    codigoMarca: '21',
    versoes: ['7540', '7538'],
  },
  {
    chave: 'kwid',
    rotulo: 'Renault Kwid 1.0',
    detalhe: 'Zen · Life (2018–22)',
    codigoMarca: '48',
    versoes: ['8023', '8022'],
  },
  {
    chave: 'polo',
    rotulo: 'Volkswagen Polo 1.0',
    detalhe: 'Track · 1.0 MPI · 1.0 Flex (2018–22) · Robust',
    codigoMarca: '59',
    versoes: ['10176', '10107', '8070', '11778'],
  },
];
