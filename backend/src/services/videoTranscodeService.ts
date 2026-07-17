import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ffmpegPath from 'ffmpeg-static';

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg binary not available'));
      return;
    }

    const proc = spawn(ffmpegPath as string, args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Reassemble sequential MediaRecorder chunk buffers (produced by repeated
 * `ondataavailable` calls of a single continuous recording) into one MP4
 * (H.264/AAC) file. Chunks must be concatenated as raw bytes in recording
 * order first - only the first chunk carries the WebM header, so ffmpeg's
 * concat demuxer (which expects independently-decodable inputs) can't be
 * used here.
 */
export async function chunksToMp4(chunkBuffers: Buffer[]): Promise<Buffer> {
  const workDir = path.join(os.tmpdir(), `dc-transcode-${uuidv4()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const inputPath = path.join(workDir, 'input.webm');
    const outputPath = path.join(workDir, 'output.mp4');
    await fs.writeFile(inputPath, Buffer.concat(chunkBuffers));

    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    ]);

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
