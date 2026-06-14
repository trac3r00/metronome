import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import Database from "better-sqlite3";

import { DEFAULT_STATE, makeEmptyPresets, normalizeState } from "./state.js";

const DEFAULT_SETTINGS = Object.freeze({
  control_style: "dial",
  theme: "auto",
  fullscreen_only: false,
});
const CONTROL_STYLES = new Set(["dial", "slider", "wheel", "tap"]);
const THEMES = new Set(["auto", "light", "dark"]);
const METERS = new Set(["4/4", "3/4", "6/8"]);
const DEFAULT_SETTINGS_PRESETS = Object.freeze([60, 80, 100, 120, 140]);
const MIN_BPM = 30;
const MAX_BPM = 300;

export class StateStore {
  constructor(dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrateLegacyPresetTable();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        bpm INTEGER NOT NULL,
        beats_per_bar INTEGER NOT NULL,
        beat_unit INTEGER NOT NULL,
        playing INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_presets (
        slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 10),
        bpm INTEGER NOT NULL,
        beats_per_bar INTEGER NOT NULL,
        beat_unit INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        control_style TEXT NOT NULL DEFAULT 'dial',
        theme TEXT NOT NULL DEFAULT 'auto',
        fullscreen_only INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        bpm INTEGER NOT NULL,
        meter TEXT NOT NULL,
        name TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO room_state (id, bpm, beats_per_bar, beat_unit, playing) VALUES (1, ?, ?, ?, ?)",
      )
      .run(DEFAULT_STATE.bpm, DEFAULT_STATE.beats_per_bar, DEFAULT_STATE.beat_unit, 0);
    this.ensureSettingsColumns();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO settings (id, control_style, theme, fullscreen_only, updated_at) VALUES (1, ?, ?, ?, ?)",
      )
      .run(DEFAULT_SETTINGS.control_style, DEFAULT_SETTINGS.theme, DEFAULT_SETTINGS.fullscreen_only ? 1 : 0, now);
    this.seedSettingsPresets(now);
  }

  migrateLegacyPresetTable() {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'presets'")
      .get();
    if (!table) {
      return;
    }
    const columns = this.db.prepare("PRAGMA table_info(presets)").all().map((column) => column.name);
    if (columns.includes("slot") && !columns.includes("id")) {
      this.db.exec("ALTER TABLE presets RENAME TO room_presets");
    }
  }

  seedSettingsPresets(now = Date.now()) {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM presets").get();
    if (count.count > 0) {
      return;
    }
    const insert = this.db.prepare(
      "INSERT INTO presets (id, position, bpm, meter, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const seed = this.db.transaction(() => {
      DEFAULT_SETTINGS_PRESETS.forEach((bpm, position) => {
        insert.run(randomUUID(), position, bpm, "4/4", null, now);
      });
    });
    seed();
  }

  ensureSettingsColumns() {
    const columns = this.db.prepare("PRAGMA table_info(settings)").all().map((column) => column.name);
    if (!columns.includes("fullscreen_only")) {
      this.db.exec("ALTER TABLE settings ADD COLUMN fullscreen_only INTEGER NOT NULL DEFAULT 0");
    }
  }

  load() {
    const row = this.db.prepare("SELECT * FROM room_state WHERE id = 1").get();
    const presets = makeEmptyPresets();
    for (const preset of this.db.prepare("SELECT * FROM room_presets ORDER BY slot").all()) {
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
      this.db.prepare("DELETE FROM room_presets").run();
      const insert = this.db.prepare(
        "INSERT INTO room_presets (slot, bpm, beats_per_bar, beat_unit) VALUES (?, ?, ?, ?)",
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

  getSettings() {
    const settings = this.db.prepare("SELECT * FROM settings WHERE id = 1").get();
    return {
      control_style: settings.control_style,
      theme: settings.theme,
      fullscreen_only: Boolean(settings.fullscreen_only),
      updated_at: settings.updated_at,
      presets: this.listPresets(),
    };
  }

  updateSettings(patch) {
    const current = this.getSettings();
    const next = {
      control_style:
        patch.control_style === undefined ? current.control_style : parseControlStyle(patch.control_style),
      theme: patch.theme === undefined ? current.theme : parseTheme(patch.theme),
      fullscreen_only:
        patch.fullscreen_only === undefined ? current.fullscreen_only : parseBoolean(patch.fullscreen_only),
      updated_at: Date.now(),
    };
    this.db
      .prepare("UPDATE settings SET control_style = ?, theme = ?, fullscreen_only = ?, updated_at = ? WHERE id = 1")
      .run(next.control_style, next.theme, next.fullscreen_only ? 1 : 0, next.updated_at);
    return this.getSettings();
  }

  listPresets() {
    return this.db
      .prepare("SELECT id, position, bpm, meter, name, created_at FROM presets ORDER BY position, created_at")
      .all();
  }

  createPreset(value) {
    const preset = {
      id: randomUUID(),
      position: this.nextPresetPosition(),
      bpm: parseBpm(value.bpm),
      meter: parseMeter(value.meter),
      name: parseOptionalName(value.name),
      created_at: Date.now(),
    };
    this.db
      .prepare("INSERT INTO presets (id, position, bpm, meter, name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(preset.id, preset.position, preset.bpm, preset.meter, preset.name, preset.created_at);
    return preset;
  }

  updatePreset(id, patch) {
    const current = this.findPreset(id);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      bpm: patch.bpm === undefined ? current.bpm : parseBpm(patch.bpm),
      meter: patch.meter === undefined ? current.meter : parseMeter(patch.meter),
      name: patch.name === undefined ? current.name : parseOptionalName(patch.name),
    };
    this.db
      .prepare("UPDATE presets SET bpm = ?, meter = ?, name = ? WHERE id = ?")
      .run(next.bpm, next.meter, next.name, id);
    return this.findPreset(id);
  }

  deletePreset(id) {
    const deleted = this.db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    if (deleted.changes === 0) {
      return false;
    }
    this.compactPresetPositions();
    return true;
  }

  reorderPresets(ids) {
    if (!Array.isArray(ids)) {
      throw new StoreValidationError("Preset ids must be an array");
    }
    const existing = this.listPresets();
    const existingIds = new Set(existing.map((preset) => preset.id));
    const requestedIds = new Set(ids);
    if (ids.length !== existing.length || requestedIds.size !== ids.length) {
      throw new StoreValidationError("Preset ids must include every preset exactly once");
    }
    for (const id of ids) {
      if (!existingIds.has(id)) {
        throw new StoreValidationError("Preset ids must include every preset exactly once");
      }
    }
    const update = this.db.prepare("UPDATE presets SET position = ? WHERE id = ?");
    const reorder = this.db.transaction(() => {
      ids.forEach((id, position) => update.run(position, id));
    });
    reorder();
    return this.listPresets();
  }

  findPreset(id) {
    return this.db
      .prepare("SELECT id, position, bpm, meter, name, created_at FROM presets WHERE id = ?")
      .get(id);
  }

  nextPresetPosition() {
    const row = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM presets").get();
    return row.position;
  }

  compactPresetPositions() {
    const presets = this.listPresets();
    const update = this.db.prepare("UPDATE presets SET position = ? WHERE id = ?");
    const compact = this.db.transaction(() => {
      presets.forEach((preset, position) => update.run(position, preset.id));
    });
    compact();
  }

  health() {
    const room = this.db.prepare("SELECT COUNT(*) AS count FROM room_state WHERE id = 1").get();
    const presets = this.db.prepare("SELECT COUNT(*) AS count FROM room_presets").get();
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

export class StoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreValidationError";
  }
}

function parseControlStyle(value) {
  if (!CONTROL_STYLES.has(value)) {
    throw new StoreValidationError("Control style must be dial, slider, wheel, or tap");
  }
  return value;
}

function parseTheme(value) {
  if (!THEMES.has(value)) {
    throw new StoreValidationError("Theme must be auto, light, or dark");
  }
  return value;
}

function parseBpm(value) {
  if (!Number.isInteger(value) || value < MIN_BPM || value > MAX_BPM) {
    throw new StoreValidationError("BPM must be between 30 and 300");
  }
  return value;
}

function parseMeter(value) {
  if (!METERS.has(value)) {
    throw new StoreValidationError("Meter must be 4/4, 3/4, or 6/8");
  }
  return value;
}

function parseOptionalName(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new StoreValidationError("Preset name must be text");
  }
  return value.trim() || null;
}

function parseBoolean(value) {
  if (typeof value !== "boolean") {
    throw new StoreValidationError("Fullscreen mode must be true or false");
  }
  return value;
}
