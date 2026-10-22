/**
 * Audio processing utilities for Gemini Live API
 *
 * Input: 16kHz 16-bit Mono Linear PCM (Little-Endian)
 * Output: 24kHz 16-bit Mono Linear PCM (Little-Endian)
 */

export class LiveAudioPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private isMuted = false;

  constructor() {
    // Lazily initialized on user gesture
  }

  public init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 24000 });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public playChunk(base64Pcm: string) {
    this.init();
    if (!this.ctx || !this.analyser || this.isMuted) return;

    try {
      const binary = atob(base64Pcm);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Convert 16-bit signed PCM to float32
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
      }

      const audioBuffer = this.ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.analyser);

      const currentTime = this.ctx.currentTime;
      // Schedule gapless playback with a small 25ms jitter buffer
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.025;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) {
          this.activeSources.splice(idx, 1);
        }
      };
    } catch (err) {
      console.error('Error decoding/playing audio chunk:', err);
    }
  }

  public stopAndClear() {
    this.activeSources.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch (e) {}
    });
    this.activeSources = [];
    if (this.ctx) {
      this.nextStartTime = this.ctx.currentTime;
    } else {
      this.nextStartTime = 0;
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stopAndClear();
    }
  }

  public getVolumeLevel(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (data.length * 255);
  }

  public close() {
    this.stopAndClear();
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (e) {}
      this.ctx = null;
      this.analyser = null;
    }
  }
}

export class LiveAudioRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private onDataCallback: ((base64Pcm: string) => void) | null = null;
  private isPaused = false;

  public async start(onData: (base64Pcm: string) => void) {
    this.onDataCallback = onData;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;

    // Use 16kHz audio context for microphone capture
    this.ctx = new AudioCtx({ sampleRate: 16000 });
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);

    // Buffer size of 4096 gives ~256ms frames at 16kHz
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.analyser.connect(this.processor);
    this.processor.connect(this.ctx.destination);

    this.processor.onaudioprocess = (e) => {
      if (this.isPaused) return;
      const inputBuffer = e.inputBuffer.getChannelData(0);
      const base64 = this.float32ToPcm16Base64(inputBuffer);
      if (this.onDataCallback) {
        this.onDataCallback(base64);
      }
    };
  }

  private float32ToPcm16Base64(input: Float32Array): string {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // Little-endian
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public getVolumeLevel(): number {
    if (!this.analyser || this.isPaused) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (data.length * 255);
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
  }

  public isMuted(): boolean {
    return this.isPaused;
  }

  public stop() {
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (e) {}
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {}
      this.source = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (e) {}
      this.analyser = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (e) {}
      this.ctx = null;
    }
    this.onDataCallback = null;
    this.isPaused = false;
  }
}
