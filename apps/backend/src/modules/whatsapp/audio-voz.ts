import { spawn } from 'child_process';
import { AUDIO_MAX_SEGUNDOS_WHATSAPP } from '@azit/utils';

// Áudio gravado na tela Conversas (doc 02 §34.6). O navegador grava em
// webm/opus (Chrome) ou ogg/opus (Firefox); a Meta só aceita voz em ogg/opus.
// O ffmpeg (instalado na imagem do backend) refaz o arquivo: mono, opus a
// 48 kHz, cortado no limite de 5 minutos. FFMPEG_PATH troca o executável.
//
// 26/11 (produção: quase metade dos áudios voltava "131053 Media upload error ·
// Media file scrutiny failed"): a gravação do Chrome não tem duração e pode
// começar com carimbo de tempo negativo, e o ogg saía com isso e com os
// metadados do navegador. Agora: só a 1ª trilha de áudio, sem metadados,
// tempo começando em zero, perfil de voz do opus — e o envio à Meta declara
// "audio/ogg; codecs=opus", como pede a documentação (MIME_VOZ_UPLOAD).

export const MIME_VOZ = 'audio/ogg';
export const MIME_VOZ_UPLOAD = 'audio/ogg; codecs=opus';

export class ErroConversaoAudio extends Error {}

export const ARGS_FFMPEG_VOZ = [
  '-hide_banner', '-loglevel', 'error',
  '-fflags', '+genpts',
  '-i', 'pipe:0',
  '-map', '0:a:0', '-map_metadata', '-1', '-vn',
  '-t', String(AUDIO_MAX_SEGUNDOS_WHATSAPP),
  '-ac', '1', '-ar', '48000',
  '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip',
  '-avoid_negative_ts', 'make_zero',
  '-f', 'ogg', 'pipe:1',
];

export function converterParaVoz(entrada: Buffer, executavel = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(executavel, ARGS_FFMPEG_VOZ, { stdio: ['pipe', 'pipe', 'pipe'] });
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
