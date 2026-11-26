import { PreparacaoService } from './preparacao.service';
import { motivoPreparacaoPendente, preparacaoAbertaDo, statusAoSoltarReserva, ativoOferecivel } from './preparacao.regras';

// Preparação do veículo (doc 02 §25.8): banco em memória com o mínimo que o
// serviço usa — status do carro, preparação, itens, modelo e auditoria.

type Ativo = { id: string; status: string; tipo: string };
type Prep = { id: string; ativoId: string; motivo: string; oQueFalta: string | null; abertaEm: Date; abertaPor: string | null; concluidaEm: Date | null; concluidaPor: string | null };
type Item = { id: string; preparacaoId: string; descricao: string; ordem: number; avulso: boolean; situacao: string | null; marcadoEm: Date | null; marcadoPor: string | null };

function banco(ativos: Ativo[], modelo = ['Troca de óleo e filtro', 'Instalação do rastreador', 'VIP']) {
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const preps: Prep[] = [];
  const itens: Item[] = [];
  const modeloLinhas = modelo.map((descricao, i) => ({ id: `m${i + 1}`, descricao, ordem: i + 1, deletedAt: null as Date | null }));
  const auditoria: { acao: string; depois?: unknown }[] = [];
  const comItens = (p: Prep) => ({ ...p, itens: itens.filter((i) => i.preparacaoId === p.id).sort((a, b) => a.ordem - b.ordem) });
  const casa = (p: Prep, w: { ativoId?: string | { in: string[] }; concluidaEm?: null }) =>
    (w.ativoId === undefined || (typeof w.ativoId === 'string' ? p.ativoId === w.ativoId : w.ativoId.in.includes(p.ativoId))) &&
    (w.concluidaEm === undefined || p.concluidaEm === null);

  const db: Record<string, unknown> = {
    ativo: {
      findFirst: async ({ where }: { where: { id: string } }) => ativos.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Ativo> }) => Object.assign(ativos.find((a) => a.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Partial<Ativo> }) => {
        const alvo = ativos.filter((a) => a.id === where.id && (!where.status || a.status === where.status));
        alvo.forEach((a) => Object.assign(a, data));
        return { count: alvo.length };
      },
    },
    preparacaoAtivo: {
      findFirst: async ({ where }: { where: { ativoId: string; concluidaEm?: null } }) => {
        const p = preps.find((x) => casa(x, where));
        return p ? comItens(p) : null;
      },
      findMany: async ({ where }: { where: { ativoId: string | { in: string[] }; concluidaEm?: null } }) => preps.filter((x) => casa(x, where)).map(comItens),
      create: async ({ data }: { data: { ativoId: string; motivo: string; oQueFalta: string | null; abertaPor: string | null; itens: { create: { descricao: string; ordem: number }[] } } }) => {
        const p: Prep = { id: id('p'), ativoId: data.ativoId, motivo: data.motivo, oQueFalta: data.oQueFalta, abertaEm: new Date(), abertaPor: data.abertaPor, concluidaEm: null, concluidaPor: null };
        preps.push(p);
        data.itens.create.forEach((i) => itens.push({ id: id('i'), preparacaoId: p.id, descricao: i.descricao, ordem: i.ordem, avulso: false, situacao: null, marcadoEm: null, marcadoPor: null }));
        return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Prep> }) => Object.assign(preps.find((p) => p.id === where.id)!, data),
    },
    preparacaoItem: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        const i = itens.find((x) => x.id === where.id);
        return i ? { ...i, preparacao: preps.find((p) => p.id === i.preparacaoId)! } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => Object.assign(itens.find((i) => i.id === where.id)!, data),
      create: async ({ data }: { data: { preparacaoId: string; descricao: string; ordem: number; avulso: boolean } }) => {
        const i: Item = { id: id('i'), situacao: null, marcadoEm: null, marcadoPor: null, ...data };
        itens.push(i);
        return i;
      },
      delete: async ({ where }: { where: { id: string } }) => itens.splice(itens.findIndex((i) => i.id === where.id), 1)[0],
    },
    checklistPreparacaoModelo: {
      findMany: async () => modeloLinhas.filter((m) => !m.deletedAt).sort((a, b) => a.ordem - b.ordem),
      updateMany: async ({ where }: { where: { id: { notIn: string[] } } }) => {
        modeloLinhas.filter((m) => !m.deletedAt && !where.id.notIn.includes(m.id)).forEach((m) => (m.deletedAt = new Date()));
      },
      update: async ({ where, data }: { where: { id: string }; data: { descricao: string; ordem: number } }) => Object.assign(modeloLinhas.find((m) => m.id === where.id)!, data),
      create: async ({ data }: { data: { descricao: string; ordem: number } }) => modeloLinhas.push({ id: id('m'), deletedAt: null, ...data }),
    },
    logAuditoria: { create: async ({ data }: { data: { acao: string; depois?: unknown } }) => auditoria.push(data) },
    usuario: { findMany: async () => [{ id: 'u1', nome: 'Ana Operadora' }] },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  const svc = new PreparacaoService({ db } as never);
  return { svc, db, ativos, preps, itens, auditoria, modeloLinhas };
}

describe('PreparacaoService — preparação do veículo (doc 02 §25.8)', () => {
  it('carro Recuperado: Liberar para venda abre o checklist do modelo e o carro fica Em preparação', async () => {
    const b = banco([{ id: 'a1', status: 'RECUPERADO', tipo: 'VEICULO' }]);
    const r = await b.svc.abrir('a1', 'RECUPERACAO', '  funilaria e vistoria ', 'u1');
    expect(b.ativos[0].status).toBe('EM_PREPARACAO');
    expect(r.aberta?.motivo).toBe('recuperacao');
    expect(r.aberta?.oQueFalta).toBe('funilaria e vistoria');
    expect(r.aberta?.abertaPor).toBe('Ana Operadora');
    expect(r.aberta?.itens.map((i) => i.descricao)).toEqual(['Troca de óleo e filtro', 'Instalação do rastreador', 'VIP']);
    expect(r.aberta?.pendentes).toBe(3);
    expect(b.auditoria.map((a) => a.acao)).toEqual(['ativo_preparacao_aberta']);
  });

  it('Liberar para venda só vale para Recuperado; Enviar para preparação só para Disponível', async () => {
    const b = banco([
      { id: 'disp', status: 'DISPONIVEL', tipo: 'VEICULO' },
      { id: 'rec', status: 'RECUPERADO', tipo: 'VEICULO' },
      { id: 'cont', status: 'EM_CONTRATO', tipo: 'VEICULO' },
      { id: 'outro', status: 'DISPONIVEL', tipo: 'OUTRO' },
    ]);
    await expect(b.svc.abrir('disp', 'RECUPERACAO', undefined)).rejects.toMatchObject({ response: { erro: 'status_invalido' } });
    await expect(b.svc.abrir('rec', 'MANUTENCAO', undefined)).rejects.toMatchObject({ response: { erro: 'status_invalido' } });
    await expect(b.svc.abrir('cont', 'MANUTENCAO', undefined)).rejects.toMatchObject({ response: { erro: 'status_invalido' } });
    await expect(b.svc.abrir('outro', 'MANUTENCAO', undefined)).rejects.toMatchObject({ response: { erro: 'nao_e_veiculo' } });
    await b.svc.abrir('disp', 'MANUTENCAO', 'oficina');
    expect(b.ativos[0].status).toBe('EM_PREPARACAO');
  });

  it('Marcar como pronto exige todos os itens feitos ou "não se aplica"; depois o carro vira Disponível', async () => {
    const b = banco([{ id: 'a1', status: 'RECUPERADO', tipo: 'VEICULO' }]);
    const r = await b.svc.abrir('a1', 'RECUPERACAO', undefined, 'u1');
    const [oleo, rastreador, vip] = r.aberta!.itens;
    await b.svc.marcarItem(oleo.id, 'feito', 'u1');
    await b.svc.marcarItem(rastreador.id, 'feito', 'u1');
    await expect(b.svc.concluir('a1', 'u1')).rejects.toMatchObject({ response: { erro: 'checklist_incompleto', mensagem: 'Falta concluir no checklist: VIP' } });
    expect(b.ativos[0].status).toBe('EM_PREPARACAO');

    const marcado = await b.svc.marcarItem(vip.id, 'nao_se_aplica', 'u1');
    expect(marcado.aberta?.itens[2]).toMatchObject({ situacao: 'nao_se_aplica', marcadoPor: 'Ana Operadora' });
    const fim = await b.svc.concluir('a1', 'u1');
    expect(b.ativos[0].status).toBe('DISPONIVEL');
    expect(fim.aberta).toBeNull();
    expect(fim.anteriores).toHaveLength(1);
    expect(fim.anteriores[0].concluidaPor).toBe('Ana Operadora');
    expect(b.auditoria.map((a) => a.acao)).toEqual([
      'ativo_preparacao_aberta', 'ativo_preparacao_item', 'ativo_preparacao_item', 'ativo_preparacao_item', 'ativo_preparacao_concluida',
    ]);
    // Concluída não aceita mais marcação.
    await expect(b.svc.marcarItem(oleo.id, null)).rejects.toMatchObject({ response: { erro: 'preparacao_concluida' } });
  });

  it('desmarcar um item volta a pendente; item incluído para o carro pode sair, o do modelo não', async () => {
    const b = banco([{ id: 'a1', status: 'DISPONIVEL', tipo: 'VEICULO' }], ['Troca de óleo e filtro']);
    const r = await b.svc.abrir('a1', 'MANUTENCAO', undefined);
    await b.svc.marcarItem(r.aberta!.itens[0].id, 'feito');
    const desfeito = await b.svc.marcarItem(r.aberta!.itens[0].id, null);
    expect(desfeito.aberta?.itens[0]).toMatchObject({ situacao: null, marcadoEm: null, marcadoPor: null });

    const comExtra = await b.svc.adicionarItem('a1', 'Trocar palheta');
    const extra = comExtra.aberta!.itens.find((i) => i.descricao === 'Trocar palheta')!;
    expect(extra.avulso).toBe(true);
    await expect(b.svc.removerItem(r.aberta!.itens[0].id)).rejects.toMatchObject({ response: { erro: 'item_do_modelo' } });
    const semExtra = await b.svc.removerItem(extra.id);
    expect(semExtra.aberta?.itens.map((i) => i.descricao)).toEqual(['Troca de óleo e filtro']);
  });

  it('não abre duas preparações para o mesmo carro', async () => {
    const b = banco([{ id: 'a1', status: 'DISPONIVEL', tipo: 'VEICULO' }]);
    await b.svc.abrir('a1', 'MANUTENCAO', undefined);
    b.ativos[0].status = 'DISPONIVEL'; // mesmo que o status tenha sido mexido por fora
    await expect(b.svc.abrir('a1', 'MANUTENCAO', undefined)).rejects.toMatchObject({ response: { erro: 'ja_em_preparacao' } });
  });

  it('carro Reservado (lista de espera) continua Reservado ao ficar pronto', async () => {
    const b = banco([{ id: 'a1', status: 'RECUPERADO', tipo: 'VEICULO' }], ['VIP']);
    const r = await b.svc.abrir('a1', 'RECUPERACAO', undefined);
    b.ativos[0].status = 'RESERVADO'; // atribuído a um aprovado da fila
    expect(await statusAoSoltarReserva(b.db as never, 'a1')).toBe('EM_PREPARACAO');
    await b.svc.marcarItem(r.aberta!.itens[0].id, 'feito');
    await b.svc.concluir('a1');
    expect(b.ativos[0].status).toBe('RESERVADO');
    expect(await statusAoSoltarReserva(b.db as never, 'a1')).toBe('DISPONIVEL');
  });

  it('mudar o modelo não altera a preparação já aberta; o novo modelo vale para a próxima', async () => {
    const b = banco([{ id: 'a1', status: 'DISPONIVEL', tipo: 'VEICULO' }, { id: 'a2', status: 'DISPONIVEL', tipo: 'VEICULO' }]);
    await b.svc.abrir('a1', 'MANUTENCAO', undefined);
    const novo = await b.svc.salvarModelo([{ id: 'm1', descricao: 'Troca de óleo e filtro' }, { descricao: 'Higienização' }], 'u1');
    expect(novo.map((m) => m.descricao)).toEqual(['Troca de óleo e filtro', 'Higienização']);
    expect((await b.svc.doAtivo('a1')).aberta?.itens).toHaveLength(3);
    const a2 = await b.svc.abrir('a2', 'MANUTENCAO', undefined);
    expect(a2.aberta?.itens.map((i) => i.descricao)).toEqual(['Troca de óleo e filtro', 'Higienização']);
    await expect(b.svc.salvarModelo([{ descricao: '   ' }])).rejects.toMatchObject({ response: { erro: 'modelo_vazio' } });
  });

  it('alerta para o funil: o que falta e o motivo de bloqueio da formalização', async () => {
    const b = banco([{ id: 'a1', status: 'RECUPERADO', tipo: 'VEICULO' }]);
    const r = await b.svc.abrir('a1', 'RECUPERACAO', 'funilaria');
    await b.svc.marcarItem(r.aberta!.itens[0].id, 'feito');
    const alerta = await preparacaoAbertaDo(b.db as never, 'a1');
    expect(alerta).toMatchObject({ oQueFalta: 'funilaria', pendentes: ['Instalação do rastreador', 'VIP'], totalItens: 3 });
    expect(motivoPreparacaoPendente(alerta!)).toBe(
      'O veículo está em preparação (falta: Instalação do rastreador, VIP). O contrato só é gerado depois que ele for marcado como pronto na ficha do veículo.',
    );
    expect(ativoOferecivel('EM_PREPARACAO')).toBe(true);
    expect(ativoOferecivel('DISPONIVEL')).toBe(true);
    expect(ativoOferecivel('RECUPERADO')).toBe(false);
    expect(ativoOferecivel('RESERVADO')).toBe(false);
  });
});
