import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sampleRate = 48000;
const timelineArgument = process.argv[4];
const timeline = timelineArgument
  ? JSON.parse(readFileSync(resolve(timelineArgument), "utf8"))
  : null;
const duration = timeline
  ? Math.ceil(timeline.durationSeconds) + 1
  : Number(process.argv[2] ?? 24);
const outputArgument = process.argv[3] ?? "public/audio/inkforge-promo.wav";
const channels = 2;
const sampleCount = sampleRate * duration;
const data = Buffer.alloc(sampleCount * channels * 2);

let seed = 0x1f2e3d4c;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

const beat = 0.5;
const chords = [
  [55, 82.41, 110],
  [65.41, 98, 130.81],
  [73.42, 110, 146.83],
  [49, 73.42, 98],
];
const cuts = timeline
  ? timeline.scenes
      .slice(1)
      .map((scene) => scene.sceneStartFrame / timeline.fps)
  : [3.2, 7.07, 11.43, 15.8, 20.37];
const chimeTimes = [duration - 3.5, duration - 3, duration - 2.5];

const envelope = (phase, length, power = 3) =>
  phase >= 0 && phase < length ? (1 - phase / length) ** power : 0;

for (let i = 0; i < sampleCount; i++) {
  const t = i / sampleRate;
  const beatPhase = t % beat;
  const halfBeatPhase = t % (beat / 2);
  const bar = Math.floor(t / 2);
  const chord = chords[bar % chords.length];

  const kickEnv = envelope(beatPhase, 0.2, 4);
  const kickFreq = 48 + 95 * Math.exp(-beatPhase * 24);
  const kick = Math.sin(2 * Math.PI * kickFreq * t) * kickEnv * 0.48;

  const snarePhase = (t + beat) % (beat * 2);
  const snareEnv = envelope(snarePhase, 0.14, 3);
  const snare = random() * snareEnv * 0.13;

  const hatEnv = envelope(halfBeatPhase, 0.045, 6);
  const hat = random() * hatEnv * 0.055;

  let pad = 0;
  for (let note = 0; note < chord.length; note++) {
    const f = chord[note];
    pad += Math.sin(2 * Math.PI * f * t + note * 0.7) * 0.038;
    pad += Math.sin(2 * Math.PI * f * 2.005 * t) * 0.015;
  }
  const padBreath = 0.55 + 0.45 * Math.sin((Math.PI * (t % 4)) / 4);
  pad *= padBreath;

  const arpNotes = [220, 277.18, 329.63, 440, 329.63, 277.18, 246.94, 329.63];
  const arpIndex = Math.floor(t / (beat / 2)) % arpNotes.length;
  const arpEnv = envelope(halfBeatPhase, 0.2, 2.4);
  const arp = Math.sin(2 * Math.PI * arpNotes[arpIndex] * t) * arpEnv * 0.075;

  let whoosh = 0;
  for (const cut of cuts) {
    const phase = t - (cut - 0.48);
    if (phase >= 0 && phase < 0.55) {
      const rise = Math.sin((Math.PI * phase) / 0.55) ** 2;
      whoosh += random() * rise * 0.12;
      whoosh += Math.sin(2 * Math.PI * (260 + phase * 1100) * t) * rise * 0.035;
    }
  }

  let chime = 0;
  for (const at of chimeTimes) {
    const phase = t - at;
    if (phase >= 0 && phase < 1.2) {
      const env = Math.exp(-phase * 4.2);
      chime +=
        (Math.sin(2 * Math.PI * 659.25 * phase) +
          Math.sin(2 * Math.PI * 987.77 * phase) * 0.45) *
        env *
        0.08;
    }
  }

  const masterFade = Math.min(1, t / 0.5, (duration - t) / 1.2);
  const mono =
    Math.tanh((kick + snare + hat + pad + arp + whoosh + chime) * 1.25) *
    masterFade;
  const shimmer = Math.sin(2 * Math.PI * 0.09 * t) * 0.05;
  const left = Math.max(-1, Math.min(1, mono * (0.96 + shimmer)));
  const right = Math.max(-1, Math.min(1, mono * (0.96 - shimmer)));
  data.writeInt16LE(Math.round(left * 32767), i * 4);
  data.writeInt16LE(Math.round(right * 32767), i * 4 + 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * channels * 2, 28);
header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const output = resolve(outputArgument);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, data]));
console.log(`Generated ${output} (${duration}s, stereo, ${sampleRate}Hz)`);
