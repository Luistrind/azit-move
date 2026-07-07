import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../database/prisma.service';

// Central de documentos do veículo (Doc 2 §4.4-A): CRLV, nota fiscal, laudo...
// Arquivo gravado em disco (uploads/ativos), indexado pelo id do documento.
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'ativos');

@Injectable()
export class AtivoDocumentoService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(ativoId: string) {
    const docs = await this.prisma.db.ativoDocumento.findMany({
      where: { ativoId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tipo: true, nome: true, createdAt: true },
    });
    return docs.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      nome: d.nome,
      anexadoEm: d.createdAt.toISOString(),
    }));
  }

  async anexar(
    ativoId: string,
    dto: { tipo: string; nome: string; conteudo: string },
    usuarioId: string,
  ) {
    const ativo = await this.prisma.db.ativo.findFirst({ where: { id: ativoId }, select: { id: true } });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });

    const doc = await this.prisma.db.ativoDocumento.create({
      data: {
        ativoId,
        tipo: dto.tipo.trim().toLowerCase(),
        nome: dto.nome,
        arquivoRef: dto.nome,
        criadoPor: usuarioId,
      },
    });
    const base64 = dto.conteudo.includes(',') ? dto.conteudo.split(',')[1] : dto.conteudo;
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, doc.id), Buffer.from(base64, 'base64'));
    return this.listar(ativoId);
  }

  async arquivo(docId: string): Promise<{ nome: string; buffer: Buffer }> {
    const doc = await this.prisma.db.ativoDocumento.findFirst({ where: { id: docId, deletedAt: null } });
    if (!doc) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Documento não encontrado' });
    try {
      const buffer = await fs.readFile(join(UPLOADS_DIR, doc.id));
      return { nome: doc.nome, buffer };
    } catch {
      throw new NotFoundException({ erro: 'arquivo_ausente', mensagem: 'Arquivo não encontrado em disco' });
    }
  }

  async remover(docId: string) {
    const doc = await this.prisma.db.ativoDocumento.findFirst({ where: { id: docId, deletedAt: null } });
    if (!doc) throw new NotFoundException({ erro: 'nao_encontrado' });
    await this.prisma.db.ativoDocumento.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    return this.listar(doc.ativoId);
  }
}
