import { spawn } from 'child_process';
import { AUDIO_MAX_SEGUNDOS_WHATSAPP } from '@azit/utils';

// Áudio gravado na tela Conversas (doc 02 §34.6). O navegador grava em
// webm/opus (Chrome) ou ogg/opus (Firefox); a Meta só aceita voz em ogg/opus.
// O ffmpeg (instalado na imagem do backend) refaz o contêiner: mono, opus,
// cortado no limite de 5 minutos. FFMPEG_PATH troca o executável.

export const MIME_VOZ = 'audio/ogg';

export class ErroConversaoAudio extends Error {}

export function converterParaVoz(entrada: Buffer, executavel = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-t', String(AUDIO_MAX_SEGUNDOS_WHATSAPP), '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'];
    let proc;
    try {
      proc = spawn(executavel, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new ErroConversaoAudio(`conversão de áudio indisponível: ${(e as Error).message}`));
      return;
    }
    const saida: Buffer[] = [];
    let erro = '';
    proc.stdout.on('data', (c: Buffer) => saida.push(c));
    proc.stderr.on('data', (c: Buffer) => (erro += c.toString()));
    proc.on('error', (e) => reject(new ErroConversaoAudio(`conversão de áudio indisponível (ffmpeg): ${e.message}`)));
    proc.on('close', (codigo) => {
      const buf = Buffer.concat(saida);
      if (codigo === 0 && buf.length > 0) resolve(buf);
      else reject(new ErroConversaoAudio(`conversão de áudio falhou: ${erro.trim().slice(0, 300) || `código ${codigo}`}`));
    });
    proc.stdin.on('error', () => undefined); // ffmpeg pode fechar a entrada antes do fim
    proc.stdin.end(entrada);
  });
}
