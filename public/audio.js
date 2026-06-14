export class AudioScheduler {
  constructor(onBeat) {
    this.onBeat = onBeat;
    this.context = null;
    this.timer = null;
    this.nextNoteTime = 0;
    this.beat = 0;
    this.state = null;
  }

  async start(state) {
    this.state = state;
    this.context ??= new AudioContext();
    await this.context.resume();
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.beat = 0;
    this.timer ??= setInterval(() => this.scheduleAhead(), 25);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  update(state) {
    this.state = state;
  }

  scheduleAhead() {
    if (!this.context || !this.state) {
      return;
    }
    while (this.nextNoteTime < this.context.currentTime + 0.12) {
      this.scheduleClick(this.nextNoteTime, this.beat === 0);
      this.onBeat(this.beat, Math.max(0, this.nextNoteTime - this.context.currentTime));
      this.beat = (this.beat + 1) % this.state.beats_per_bar;
      this.nextNoteTime += 60 / this.state.bpm;
    }
  }

  scheduleClick(time, downbeat) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = downbeat ? 1568 : 1046.5;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(downbeat ? 0.55 : 0.32, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.06);
  }
}
