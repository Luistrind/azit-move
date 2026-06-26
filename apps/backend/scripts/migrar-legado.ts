/**
 * 7.4 — Migração do legado. Importa contratos legados via a MESMA API de
 * originação (POST /contratos/originar), em lote. Aqui usamos uma amostra inline;
 * a migração real recebe o export dos 76 contratos legados no mesmo formato PopHub.
 *
 * Uso: pnpm --filter backend migrar:legado   (backend precisa estar de pé)
 */
const BASE = process.env.AZIT_API ?? 'http://localhost:3001/api/v1';
const EMAIL = 'admin@azit.com.br';
const SENHA = 'azit123';

// Amostra do "export legado" (formato PopHub). Valores em centavos.
const LEGADO = [
  {
    contrato: {
      numero_origem: 'LEG-0001',
      data_assinatura: '2025-11-10',
      data_primeira_parcela: '2025-11-17',
      periodicidade: 'semanal',
      indice_reajuste: 'ipca',
      taxa_multa_atraso: 2.0,
      taxa_juros_atraso_mensal: 1.0,
      taxa_desconto_quitacao_diaria: 0.033,
    },
    cliente: {
      nome: 'Antônio Legado da Silva',
      tipo_pessoa: 'pf',
      cpf_cnpj: '15350946056',
      whatsapp: '5527990000001',
      cidade: 'Vila Velha',
      estado: 'ES',
    },
    ativo: {
      chassi: '9BLEGADO00R900001',
      placa: 'LEG1A01',
      marca: 'Fiat',
      modelo: 'Argo',
      ano_modelo: 2023,
      origem: 'locadora',
      combustivel: 'flex',
      valor_aquisicao: 8000000,
    },
    itens_contratados: [
      { tipo_produto: 'parcelamento_veiculo', natureza: 'parcelado', valor_total: 7800000, valor_parcela: 75000, numero_parcelas: 104, credor: 'azit' },
      { tipo_produto: 'protecao_veicular', natureza: 'recorrente', valor: 5000, credor: 'azit' },
    ],
    entrada: { valor: 200000, asaas_payment_id: 'pay_leg_0001', data_pagamento: '2025-11-10' },
  },
  {
    contrato: {
      numero_origem: 'LEG-0002',
      data_assinatura: '2025-12-01',
      data_primeira_parcela: '2025-12-08',
      periodicidade: 'semanal',
    },
    cliente: {
      nome: 'Beatriz Legado Souza',
      tipo_pessoa: 'pf',
      cpf_cnpj: '24988609008',
      whatsapp: '5527990000002',
    },
    ativo: {
      chassi: '9BLEGADO00R900002',
      placa: 'LEG2B02',
      marca: 'Chevrolet',
      modelo: 'Onix',
      ano_modelo: 2024,
      origem: 'particular',
      combustivel: 'flex',
      valor_aquisicao: 9000000,
    },
    itens_contratados: [
      { tipo_produto: 'parcelamento_veiculo', natureza: 'parcelado', valor_total: 8700000, valor_parcela: 87000, numero_parcelas: 100, credor: 'azit' },
    ],
    entrada: { valor: 300000, asaas_payment_id: 'pay_leg_0002', data_pagamento: '2025-12-01' },
  },
];

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, senha: SENHA }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };

  let ok = 0;
  let falhas = 0;
  for (const contrato of LEGADO) {
    const r = await fetch(`${BASE}/contratos/originar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(contrato),
    });
    const body = (await r.json()) as Record<string, unknown>;
    if (r.status === 201) {
      ok += 1;
      console.log(`✅ ${contrato.contrato.numero_origem} -> ${body.numero} (${body.total_parcelas_geradas} parcelas)`);
    } else {
      falhas += 1;
      console.log(`❌ ${contrato.contrato.numero_origem}: ${r.status} ${body.erro ?? ''} ${body.mensagem ?? ''}`);
    }
  }
  console.log(`\nMigração concluída: ${ok} importados, ${falhas} falhas (de ${LEGADO.length}).`);
}

main().catch((e) => {
  console.error('Migração falhou:', e);
  process.exit(1);
});
