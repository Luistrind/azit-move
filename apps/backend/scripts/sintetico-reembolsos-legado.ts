/**
 * Cenários SINTÉTICOS do backfill de Reembolso Parcelado em caso migrado
 * (doc 02 §26.8, 16/10/2026) — reproduz os três casos reais com dados falsos
 * e exercita o service de ponta a ponta sobre um banco (de preferência
 * descartável): cria os contratos "com defeito", lista, faz a prévia, grava,
 * confere o que nasceu e grava DE NOVO para provar a idempotência.
 *
 *   W  Wallace  — declarada semanal, "Manutenção troca de óleo" 115,63 em 10/11 e
 *                 17/11/2025 (a 2ª paga com atraso, encargo 22,62). A fatura nasceu
 *                 SEM a despesa (997,00); a cobrança do Asaas vale 1.112,63 → "faltante".
 *   R  Robson   — declarada mensal, "1 cota do IPVA 2026 R$ 257,00" em 12/02/2026 → "faltante".
 *   E  Ezequias — por regras, "Reembolso filtro de ar R$ 40,00" em 17/11/2025: o total
 *                 da fatura já é 1.037,00 (cobrado) e os itens somam 997,00 → "folga".
 *
 * Uso (de apps/backend, com DATABASE_URL apontando para o banco de teste):
 *   pnpm exec ts-node scripts/sintetico-reembolsos-legado.ts            # cria + roda tudo
 *   pnpm exec ts-node scripts/sintetico-reembolsos-legado.ts --simular  # cria + só prévia
 *   pnpm exec ts-node scripts/sintetico-reembolsos-legado.ts --limpar   # apaga o que criou
 * Os registros levam a marca "SINT-RP" no número do contrato e no CPF 000000000xx.
 */
import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { LegadoReembolsosService } from '../src/modules/migracao-legado/legado-reembolsos.service';

const prisma = new PrismaService();
const svc = new LegadoReembolsosService(prisma);
const USUARIO = 'sintetico-backfill';
const d = (iso: string) => new Date(`${iso}T03:00:00.000Z`);
const R = (c: number) => (c / 100).toFixed(2);
const PARCELA = 94_200, SEGURO = 5_000, TAXA = 500, PADRAO = PARCELA + SEGURO + TAXA;

type Semana = { venc: string; pagoEm?: string; encargo?: number; cobranca: { id: string; valor: number; pago?: number; descricao: string }; totalFatura?: number };

async function criarContrato(p: { chave: string; nome: string; cpf: string; numero: string; periodicidade: 'SEMANAL' | 'MENSAL'; semanas: Semana[] }) {
  const titular = await prisma.db.titular.create({ data: { nome: p.nome, tipoPessoa: 'PF', cpfCnpj: p.cpf, whatsapp: '5527999990000', asaasCustomerId: `cus_sint_${p.chave}` }, select: { id: true } });
  const conta = await prisma.db.conta.create({ data: { titularId: titular.id }, select: { id: true } });
  const caso = await prisma.db.casoMigracaoLegado.create({ data: { asaasCustomerId: `cus_sint_${p.chave}`, nome: p.nome, cpfCnpj: p.cpf, status: 'MIGRADO', situacao: 'SEM_VENCIDA', prioridade: 1, coletadoEm: new Date(), migradoEm: new Date(), migradoPor: USUARIO, titularId: titular.id, migracaoResumo: { contratoNumero: p.numero, reembolsos: 0, reembolsosIds: [] } }, select: { id: true } });
  const refLegado = JSON.stringify({ legado: 1, protS: SEGURO, taxaS: TAXA });
  const contrato = await prisma.db.contratoCredito.create({
    data: {
      numero: p.numero, contaId: conta.id, legadoCasoId: caso.id, catalogoVersaoRef: refLegado,
      dataAssinatura: d(p.semanas[0].venc), dataPrimeiraParcela: d(p.semanas[0].venc),
      valorTotal: R(48 * PARCELA), valorEntrada: '0', saldoDevedor: R(48 * PARCELA), modalidade: 'ASSINATURA', cronogramaGeradoEm: new Date(),
      numeroParcelas: 48, valorParcelaInicial: R(PARCELA), periodicidade: p.periodicidade, status: 'ATIVO', taxaDescontoQuitacao: 0.025,
      snapshotJson: { legado: { casoId: caso.id, sintetico: true } },
    }, select: { id: true, numero: true },
  });
  await prisma.db.casoMigracaoLegado.update({ where: { id: caso.id }, data: { contratoId: contrato.id } });
  const item = await prisma.db.itemContratado.create({ data: { contratoId: contrato.id, descricao: 'Compra Parcelada HB20 (sintético)', natureza: 'PARCELADO', credor: 'AZIT', valor: R(48 * PARCELA), numeroParcelas: 48, periodicidade: p.periodicidade, dataInicio: d(p.semanas[0].venc) }, select: { id: true } });
  let n = 1;
  for (const s of p.semanas) {
    const pagoEm = s.pagoEm ?? s.venc;
    const atraso = pagoEm > s.venc;
    const encargo = s.encargo ?? 0;
    const total = s.totalFatura ?? PADRAO;
    const fatura = await prisma.db.fatura.create({ data: { contaId: conta.id, numero: n, periodoReferencia: d(s.venc), dataFechamento: d(s.venc), dataVencimento: d(s.venc), dataPagamento: d(pagoEm), valorTotal: R(total), valorPago: R(total + encargo), status: atraso ? 'PAGA_EM_ATRASO' : 'PAGA', asaasChargeId: s.cobranca.id }, select: { id: true } });
    const parcela = await prisma.db.parcela.create({ data: { contratoId: contrato.id, itemContratadoId: item.id, numero: n, totalParcelas: 48, display: `${n}/48`, valorNominal: R(PARCELA), dataVencimento: d(s.venc), dataPagamento: d(pagoEm), valorPago: R(PARCELA + encargo), valorEncargo: encargo ? R(encargo) : null, status: atraso ? 'PAGA_EM_ATRASO' : 'PAGA', faturaId: fatura.id }, select: { id: true } });
    await prisma.db.recebivel.create({ data: { contratoId: contrato.id, parcelaId: parcela.id, dataPrevista: d(s.venc), valorPrevisto: R(PARCELA), dataRealizada: d(pagoEm), valorRealizado: R(PARCELA), status: 'REALIZADO' } });
    await prisma.db.itemFatura.create({ data: { faturaId: fatura.id, parcelaId: parcela.id, tipo: 'PRINCIPAL', descricao: `Parcela ${n}/48 · Compra Parcelada HB20`, valor: R(PARCELA), credor: 'AZIT' } });
    await prisma.db.itemFatura.create({ data: { faturaId: fatura.id, tipo: 'SERVICO', descricao: 'Proteção veicular', valor: R(SEGURO), credor: 'AZIT' } });
    await prisma.db.itemFatura.create({ data: { faturaId: fatura.id, tipo: 'SERVICO', descricao: 'Taxa de boleto e PIX', valor: R(TAXA), credor: 'AZIT' } });
    if (encargo) await prisma.db.itemFatura.create({ data: { faturaId: fatura.id, parcelaId: parcela.id, tipo: 'ENCARGO', descricao: 'Multa e juros de atraso (legado)', valor: R(encargo), credor: 'AZIT' } });
    await prisma.db.cobrancaLegada.create({ data: { casoId: caso.id, asaasPaymentId: s.cobranca.id, valor: R(s.cobranca.valor), valorOriginal: R(s.cobranca.valor), valorPago: R(s.cobranca.pago ?? s.cobranca.valor), vencimento: d(s.venc), pagoEm: d(pagoEm), status: 'RECEIVED', tipo: 'PIX', descricao: s.cobranca.descricao, bruto: {} as Prisma.InputJsonValue } });
    n++;
  }
  return { casoId: caso.id, contratoId: contrato.id, numero: contrato.numero };
}

const OLEO = 11_563, IPVA = 25_700, FILTRO = 4_000;
const CENARIOS = {
  W: () => criarContrato({ chave: 'w', nome: 'SINT-RP Wallace (troca de óleo 2×)', cpf: '00000000001', numero: 'SINT-RP-W', periodicidade: 'SEMANAL', semanas: [
    { venc: '2025-11-03', cobranca: { id: 'pay_sint_w8', valor: PADRAO, descricao: 'Parcela 8' } },
    { venc: '2025-11-10', cobranca: { id: 'pay_sint_w9', valor: PADRAO + OLEO, descricao: 'Parcela 9 // Manutenção troca de óleo R$ 115,63' } },
    { venc: '2025-11-17', pagoEm: '2025-11-18', encargo: 2_262, cobranca: { id: 'pay_sint_w10', valor: PADRAO + OLEO, pago: PADRAO + OLEO + 2_262, descricao: 'Parcela 10 // Manutenção troca de óleo R$ 115,63' } },
    { venc: '2025-11-24', cobranca: { id: 'pay_sint_w11', valor: PADRAO, descricao: 'Parcela 11' } },
  ] }),
  R: () => criarContrato({ chave: 'r', nome: 'SINT-RP Robson (cota do IPVA)', cpf: '00000000002', numero: 'SINT-RP-R', periodicidade: 'MENSAL', semanas: [
    { venc: '2026-01-12', cobranca: { id: 'pay_sint_r1', valor: PADRAO, descricao: 'Parcela 1' } },
    { venc: '2026-02-12', cobranca: { id: 'pay_sint_r2', valor: PADRAO + IPVA, descricao: 'Parcela 2 // 1 cota do IPVA 2026 R$ 257,00' } },
    { venc: '2026-03-12', cobranca: { id: 'pay_sint_r3', valor: PADRAO, descricao: 'Parcela 3' } },
  ] }),
  E: () => criarContrato({ chave: 'e', nome: 'SINT-RP Ezequias (filtro de ar)', cpf: '00000000003', numero: 'SINT-RP-E', periodicidade: 'SEMANAL', semanas: [
    { venc: '2025-11-10', cobranca: { id: 'pay_sint_e1', valor: PADRAO, descricao: 'Parcela 11' } },
    { venc: '2025-11-17', totalFatura: PADRAO + FILTRO, cobranca: { id: 'pay_sint_e2', valor: PADRAO + FILTRO, descricao: 'Parcela 12 // Reembolso filtro de ar R$ 40,00' } },
  ] }),
};

async function limpar() {
  const casos = await prisma.casoMigracaoLegado.findMany({ where: { asaasCustomerId: { startsWith: 'cus_sint_' } }, select: { id: true, titularId: true } });
  const contratos = await prisma.contratoCredito.findMany({ where: { numero: { startsWith: 'SINT-RP-' } }, select: { id: true, contaId: true } });
  const ids = contratos.map((c) => c.id);
  const contas = [...new Set(contratos.map((c) => c.contaId))];
  await prisma.itemFatura.deleteMany({ where: { fatura: { contaId: { in: contas } } } });
  await prisma.recebivel.deleteMany({ where: { contratoId: { in: ids } } });
  await prisma.parcela.deleteMany({ where: { contratoId: { in: ids } } });
  await prisma.fatura.deleteMany({ where: { contaId: { in: contas } } });
  await prisma.itemContratado.deleteMany({ where: { contratoId: { in: ids } } });
  await prisma.casoMigracaoLegado.deleteMany({ where: { id: { in: casos.map((c) => c.id) } } });
  await prisma.contratoCredito.deleteMany({ where: { id: { in: ids } } });
  await prisma.conta.deleteMany({ where: { id: { in: contas } } });
  await prisma.titular.deleteMany({ where: { id: { in: casos.map((c) => c.titularId!).filter(Boolean) } } });
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: casos.map((c) => c.id) } } });
  console.log(`limpo: ${contratos.length} contrato(s) sintético(s), ${casos.length} caso(s)`);
}

function esperar(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`   ok  ${msg}`);
}

async function rodarCenario(nome: string, criado: { casoId: string; numero: string }, despesasDe: (faturas: { id: string; vencimento: string }[]) => { faturaId: string; valor: number; rotulo: string }[], simular: boolean, conferir: (lista: Awaited<ReturnType<typeof svc.listar>>, previa: Awaited<ReturnType<typeof svc.previa>>) => void) {
  console.log(`\n== ${nome} — caso ${criado.casoId}, contrato ${criado.numero}`);
  const lista = await svc.listar(criado.casoId);
  for (const f of lista.faturas) console.log(`   fatura ${f.numero} ${f.vencimento} ${f.status} total ${R(f.valorTotal)} pago ${f.valorPago == null ? '-' : R(f.valorPago)} itens ${R(f.somaSemEncargo)} cobrança ${f.cobranca?.asaasPaymentId} ${f.cobranca ? R(f.cobranca.valorOriginal) : ''} sugestão ${f.sugestao ? `${R(f.sugestao.valor)} (${f.sugestao.origem})` : '-'}`);
  const despesas = despesasDe(lista.faturas);
  const previa = await svc.previa(criado.casoId, { despesas });
  console.log('   prévia:', JSON.stringify({ rps: previa.rps.map((r) => ({ numero: r.numero, rotulo: r.rotulo, total: r.total, status: r.status, cotas: r.cotas.map((c) => `${c.n}/${r.numeroParcelas} ${c.vencimento} ${c.statusParcela}`) })), ajustes: previa.ajustes.map((a) => `${a.vencimento} ${a.modo} total ${a.totalAntes}->${a.totalDepois} pago ${a.pagoAntes}->${a.pagoDepois}`), erros: previa.erros, ignoradas: previa.ignoradas }));
  conferir(lista, previa);
  if (simular) return;
  const r = await svc.completar(criado.casoId, { despesas }, USUARIO);
  console.log('   gravado:', r.criados.map((c) => `${c.numero} ${c.rotulo} ${c.parcelas}× ${R(c.total)} ${c.status}`).join(' | '));
  // Conferência do que nasceu
  for (const c of r.criados) {
    const ct = await prisma.db.contratoCredito.findUniqueOrThrow({ where: { id: c.id }, include: { itensContratados: true, parcelas: { include: { recebivel: true, itensFatura: true, fatura: true }, orderBy: { numero: 'asc' } } } });
    const snap = ct.snapshotJson as { legado: { reembolsoDe: string; rotulo: string; semTaxa: boolean; backfill: unknown } };
    esperar(ct.modalidade === 'COMPRA_PARCELADA' && ct.ativoId === null && ct.catalogoVersaoRef?.includes('"legado":1') === true, `${c.numero}: COMPRA_PARCELADA sem ativo, snapshot legado (${snap.legado.rotulo}, reembolsoDe ${snap.legado.reembolsoDe})`);
    esperar(ct.itensContratados.length === 1 && ct.itensContratados[0].natureza === 'PARCELADO' && ct.itensContratados[0].descricao === `Reembolso Parcelado — ${c.rotulo}`, `${c.numero}: 1 item PARCELADO "${ct.itensContratados[0].descricao}"`);
    esperar(ct.parcelas.length === c.parcelas && ct.parcelas.every((p) => p.recebivel && p.itensFatura.length === 1 && p.faturaId), `${c.numero}: ${c.parcelas} cota(s), cada uma com recebível e item na fatura da semana`);
    for (const p of ct.parcelas) {
      const it = p.itensFatura[0];
      esperar(it.descricao === `Reembolso Parcelado · ${c.rotulo} ${p.numero}/${ct.numeroParcelas}` && Number(it.valor) === Number(p.valorNominal), `   cota ${p.display}: item "${it.descricao}" ${it.valor} na fatura ${p.fatura?.numero} (${p.fatura?.dataVencimento.toISOString().slice(0, 10)})`);
      const pagaFatura = p.fatura?.status === 'PAGA' || p.fatura?.status === 'PAGA_EM_ATRASO';
      esperar(pagaFatura ? (p.status === p.fatura?.status && p.recebivel?.status === 'REALIZADO' && Number(p.valorPago) === Number(p.valorNominal)) : (p.status === null && p.recebivel?.status === 'ESPERADO'), `   cota ${p.display}: ${p.status ?? 'em aberto'} / recebível ${p.recebivel?.status}`);
      // A fatura fecha: itens (sem encargo) = total; pago = total + encargo
      const fat = await prisma.db.fatura.findUniqueOrThrow({ where: { id: p.faturaId! }, include: { itensFatura: true } });
      const soma = fat.itensFatura.filter((i) => i.tipo !== 'ENCARGO').reduce((s, i) => s + Number(i.valor), 0);
      const enc = fat.itensFatura.filter((i) => i.tipo === 'ENCARGO').reduce((s, i) => s + Number(i.valor), 0);
      esperar(Math.abs(soma - Number(fat.valorTotal)) < 0.005 && (fat.valorPago == null || Math.abs(Number(fat.valorPago) - (Number(fat.valorTotal) + enc)) < 0.005), `   fatura ${fat.numero}: itens ${soma.toFixed(2)} = total ${fat.valorTotal}; pago ${fat.valorPago} = total + encargo ${enc.toFixed(2)}`);
    }
    esperar(ct.status === (ct.parcelas.every((p) => p.status) ? 'ENCERRADO' : 'ATIVO') && (ct.status !== 'ENCERRADO' || ct.motivoEncerramento === 'QUITACAO'), `${c.numero}: status ${ct.status}${ct.motivoEncerramento ? ` (${ct.motivoEncerramento})` : ''}`);
  }
  const caso = await prisma.db.casoMigracaoLegado.findUniqueOrThrow({ where: { id: criado.casoId }, select: { migracaoResumo: true } });
  const resumo = caso.migracaoResumo as { reembolsos: number; reembolsosIds: string[]; reembolsosCompletados: unknown[] };
  esperar(resumo.reembolsos === r.criados.length && resumo.reembolsosIds.length === r.criados.length && resumo.reembolsosCompletados.length === 1, `caso: migracaoResumo conta ${resumo.reembolsos} reembolso(s) e registra o backfill`);
  const log = await prisma.db.logAuditoria.findFirst({ where: { acao: 'legado_reembolsos_completados', entidadeId: criado.casoId } });
  esperar(!!log, 'auditoria: legado_reembolsos_completados gravado');
  // Idempotência: gravar de novo não cria nada
  const previa2 = await svc.previa(criado.casoId, { despesas });
  esperar(previa2.rps.length === 0 && previa2.ignoradas.length === despesas.length && previa2.erros.length === 0, `2ª prévia: nada a criar, ${previa2.ignoradas.length} ignorada(s)`);
  let repetiu = false;
  try { await svc.completar(criado.casoId, { despesas }, USUARIO); } catch (e) { repetiu = (e as { getResponse?: () => { erro: string } }).getResponse?.().erro === 'nada_a_criar'; }
  esperar(repetiu, '2ª gravação: recusada com nada_a_criar (idempotente)');
  const totalRps = await prisma.db.contratoCredito.count({ where: { numero: { startsWith: `${criado.numero}-RP` } } });
  esperar(totalRps === r.criados.length, `continua(m) ${totalRps} RP(s) no banco`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--limpar')) { await limpar(); return; }
  const simular = args.includes('--simular');
  await limpar();
  const w = await CENARIOS.W();
  const r = await CENARIOS.R();
  const e = await CENARIOS.E();

  await rodarCenario('Wallace — troca de óleo 2 × 115,63 (faltante)', w, (fs) => fs.filter((f) => f.vencimento === '2025-11-10' || f.vencimento === '2025-11-17').map((f) => ({ faturaId: f.id, valor: OLEO, rotulo: 'Troca de óleo' })), simular, (lista, previa) => {
    esperar(lista.faturas.every((f) => f.sugestao == null), 'sem sugestão automática (a declaração não tinha extra e não há folga)');
    esperar(previa.erros.length === 0 && previa.rps.length === 1 && previa.rps[0].numeroParcelas === 2 && previa.rps[0].status === 'ENCERRADO' && previa.rps[0].total === 2 * OLEO, '1 RP com 2 cotas, ENCERRADO, total 231,26');
    esperar(previa.ajustes.every((a) => a.modo === 'faltante') && previa.ajustes[1].pagoDepois === PADRAO + 2_262 + OLEO, 'ajuste faltante nas duas; pago da 10 = 997 + 22,62 + 115,63');
  });
  await rodarCenario('Robson — 1 cota do IPVA 2026 (faltante, mensal)', r, (fs) => fs.filter((f) => f.vencimento === '2026-02-12').map((f) => ({ faturaId: f.id, valor: IPVA, rotulo: '1 cota do IPVA 2026' })), simular, (_l, previa) => {
    esperar(previa.erros.length === 0 && previa.rps.length === 1 && previa.rps[0].numeroParcelas === 1 && previa.rps[0].status === 'ENCERRADO' && previa.rps[0].dataEncerramento === '2026-02-12', '1 RP de 1 cota, ENCERRADO em 12/02/2026');
    esperar(previa.ajustes[0].modo === 'faltante' && previa.ajustes[0].totalDepois === PADRAO + IPVA, 'ajuste faltante: total 997,00 → 1.254,00');
  });
  await rodarCenario('Ezequias — filtro de ar 40,00 (folga)', e, (fs) => fs.filter((f) => f.vencimento === '2025-11-17').map((f) => ({ faturaId: f.id, valor: FILTRO, rotulo: 'Filtro de ar' })), simular, (lista, previa) => {
    const f = lista.faturas.find((x) => x.vencimento === '2025-11-17')!;
    esperar(f.sugestao?.origem === 'folga' && f.sugestao.valor === FILTRO, 'tela sugere 40,00 pela folga da fatura');
    esperar(previa.erros.length === 0 && previa.rps.length === 1 && previa.ajustes[0].modo === 'folga' && previa.ajustes[0].totalDepois === PADRAO + FILTRO && previa.ajustes[0].pagoDepois === PADRAO + FILTRO, 'ajuste folga: total e pago não mudam (1.037,00)');
  });
  // Inconsistência: despesa maior que o principal (nada a absorver) é recusada e nada é gravado
  const listaE = await svc.listar(e.casoId);
  const f1 = listaE.faturas.find((x) => x.vencimento === '2025-11-10')!;
  const ruim = await svc.previa(e.casoId, { despesas: [{ faturaId: f1.id, valor: 100_000, rotulo: 'Qualquer' }] });
  esperar(ruim.erros.length === 1 && ruim.rps.length === 0 && /não comporta/.test(ruim.erros[0].motivo), `inconsistência recusada: ${ruim.erros[0]?.motivo}`);
  let bloqueou = false;
  try { await svc.completar(e.casoId, { despesas: [{ faturaId: f1.id, valor: 100_000, rotulo: 'Qualquer' }] }, USUARIO); } catch (err) { bloqueou = (err as { getResponse?: () => { erro: string } }).getResponse?.().erro === 'inconsistencias'; }
  esperar(bloqueou, 'gravação com inconsistência bloqueada (422 inconsistencias)');

  console.log(`\nCasos sintéticos ${simular ? 'criados (só prévia)' : 'criados e completados'}. Para ver na tela: /migracao-legado/${w.casoId} · /migracao-legado/${r.casoId} · /migracao-legado/${e.casoId}`);
  console.log('Para apagar: pnpm exec ts-node scripts/sintetico-reembolsos-legado.ts --limpar');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
