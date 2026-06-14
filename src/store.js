import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { DEFAULT_STATE, makeEmptyPresets, normalizeState } from "./state.js";

export class StateStore {
  constructor(dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        bpm INTEGER NOT NULL,
        beats_per_bar INTEGER NOT NULL,
        beat_unit INTEGER NOT NULL,
        playing INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presets (
        slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 10),
        bpm INTEGER NOT NULL,
        beats_per_bar INTEGER NOT NULL,
        beat_unit INTEGER NOT NULL
      );
    `);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO room_state (id, bpm, beats_per_bar, beat_unit, playing) VALUES (1, ?, ?, ?, ?)",
      )
      .run(DEFAULT_STATE.bpm, DEFAULT_STATE.beats_per_bar, DEFAULT_STATE.beat_unit, 0);
  }

  load() {
    const row = this.db.prepare("SELECT * FROM room_state WHERE id = 1").get();
    const presets = makeEmptyPresets();
    for (const preset of this.db.prepare("SELECT * FROM presets ORDER BY slot").all()) {
      presets[preset.slot - 1] = {
        slot: preset.slot,
        bpm: preset.bpm,
        beats_per_bar: preset.beats_per_bar,
        beat_unit: preset.beat_unit,
      };
    }
    return normalizeState({
      bpm: row.bpm,
      beats_per_bar: row.beats_per_bar,
      beat_unit: row.beat_unit,
      playing: Boolean(row.playing),
      presets,
    });
  }

  save(state) {
    const normalized = normalizeState(state);
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE room_state SET bpm = ?, beats_per_bar = ?, beat_unit = ?, playing = ? WHERE id = 1",
        )
        .run(
          normalized.bpm,
          normalized.beats_per_bar,
          normalized.beat_unit,
          normalized.playing ? 1 : 0,
        );
      this.db.prepare("DELETE FROM presets").run();
      const insert = this.db.prepare(
        "INSERT INTO presets (slot, bpm, beats_per_bar, beat_unit) VALUES (?, ?, ?, ?)",
      );
      for (const preset of normalized.presets) {
        if (preset) {
          insert.run(preset.slot, preset.bpm, preset.beats_per_bar, preset.beat_unit);
        }
      }
    });
    write();
    return normalized;
  }

  health() {
    const room = this.db.prepare("SELECT COUNT(*) AS count FROM room_state WHERE id = 1").get();
    const presets = this.db.prepare("SELECT COUNT(*) AS count FROM presets").get();
    return {
      ok: room.count === 1,
      room_state: room.count === 1,
      presets_saved: presets.count,
    };
  }

  close() {
    this.db.close();
  }
}
