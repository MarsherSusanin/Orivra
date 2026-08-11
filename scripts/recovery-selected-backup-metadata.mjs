import { TextDecoder } from "node:util";

const ERROR_MESSAGE = "Selected WAL-G backup metadata is invalid";
const MAXIMUM_DETAIL_BYTES = 4 * 1024 * 1024;
const UINT64_MAX = (1n << 64n) - 1n;
const DETAIL_KEYS = Object.freeze([
  "backup_name",
  "time",
  "wal_file_name",
  "storage_name",
  "start_time",
  "finish_time",
  "date_fmt",
  "hostname",
  "data_dir",
  "pg_version",
  "start_lsn",
  "finish_lsn",
  "is_permanent",
  "system_identifier",
  "uncompressed_size",
  "compressed_size",
]);

function fail() {
  throw new Error(ERROR_MESSAGE);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function parseLosslessJson(text) {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(text[offset] ?? "")) offset += 1;
  };
  function parseString() {
    if (text[offset] !== '"') fail();
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === "\\") {
        offset += 2;
        continue;
      }
      if (text[offset] === '"') {
        offset += 1;
        try {
          return JSON.parse(text.slice(start, offset));
        } catch {
          fail();
        }
      }
      if (text.charCodeAt(offset) < 0x20) fail();
      offset += 1;
    }
    fail();
  }
  function parseNumber() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      text.slice(offset),
    );
    if (!match) fail();
    offset += match[0].length;
    return Object.freeze({ numberToken: match[0] });
  }
  function parseArray() {
    offset += 1;
    whitespace();
    const values = [];
    if (text[offset] === "]") {
      offset += 1;
      return values;
    }
    while (true) {
      values.push(parseValue());
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return values;
      }
      if (text[offset] !== ",") fail();
      offset += 1;
      whitespace();
    }
  }
  function parseObject() {
    offset += 1;
    whitespace();
    const value = Object.create(null);
    if (text[offset] === "}") {
      offset += 1;
      return value;
    }
    while (true) {
      const key = parseString();
      if (Object.hasOwn(value, key)) fail();
      whitespace();
      if (text[offset] !== ":") fail();
      offset += 1;
      whitespace();
      value[key] = parseValue();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return value;
      }
      if (text[offset] !== ",") fail();
      offset += 1;
      whitespace();
    }
  }
  function parseValue() {
    whitespace();
    const character = text[offset];
    if (character === '"') return parseString();
    if (character === "[") return parseArray();
    if (character === "{") return parseObject();
    if (text.startsWith("true", offset)) { offset += 4; return true; }
    if (text.startsWith("false", offset)) { offset += 5; return false; }
    if (text.startsWith("null", offset)) { offset += 4; return null; }
    return parseNumber();
  }
  const value = parseValue();
  whitespace();
  if (offset !== text.length) fail();
  return value;
}

function uint64Token(value) {
  const token = value?.numberToken;
  if (typeof token !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(token)) fail();
  const integer = BigInt(token);
  if (integer < 0n || integer > UINT64_MAX) fail();
  return { token, integer };
}

function canonicalTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.([0-9]{1,6}))?Z$/.exec(
    value,
  );
  if (!match) fail();
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const milliseconds = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
    Number(second), 0,
  );
  const observed = new Date(milliseconds);
  if (
    observed.getUTCFullYear() !== Number(year) ||
    observed.getUTCMonth() + 1 !== Number(month) ||
    observed.getUTCDate() !== Number(day) ||
    observed.getUTCHours() !== Number(hour) ||
    observed.getUTCMinutes() !== Number(minute) ||
    observed.getUTCSeconds() !== Number(second)
  ) fail();
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(6, "0")}Z`;
}

function lsn(integer) {
  return `${(integer >> 32n).toString(16).toUpperCase()}/${
    (integer & 0xffff_ffffn).toString(16).toUpperCase()}`;
}

function walSegmentForLsn(timeline, value, walSegmentBytes) {
  const segmentsPerLog = (1n << 32n) / BigInt(walSegmentBytes);
  const segmentNumber = value / BigInt(walSegmentBytes);
  const log = segmentNumber / segmentsPerLog;
  const segment = segmentNumber % segmentsPerLog;
  return timeline.toString(16).toUpperCase().padStart(8, "0") +
    log.toString(16).toUpperCase().padStart(8, "0") +
    segment.toString(16).toUpperCase().padStart(8, "0");
}

export function selectRecoveryBackupMetadata({
  backupListDetailBytes,
  selectedBackupId,
  expectedSystemIdentifier,
  postgresMajor,
  walSegmentBytes,
} = {}) {
  try {
    if (
      !Buffer.isBuffer(backupListDetailBytes) ||
      backupListDetailBytes.length < 2 ||
      backupListDetailBytes.length > MAXIMUM_DETAIL_BYTES ||
      !/^base_[0-9A-F]{24}$/.test(selectedBackupId ?? "") ||
      !/^[1-9][0-9]*$/.test(expectedSystemIdentifier ?? "") ||
      postgresMajor !== 17 ||
      walSegmentBytes !== 16 * 1024 * 1024
    ) fail();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(backupListDetailBytes);
    const records = parseLosslessJson(text);
    if (!Array.isArray(records)) fail();
    const selected = records.filter((record) => record?.backup_name === selectedBackupId);
    if (selected.length !== 1 || !exactKeys(selected[0], DETAIL_KEYS)) fail();
    const record = selected[0];
    if (
      record.backup_name !== selectedBackupId ||
      record.wal_file_name !== selectedBackupId.slice(5) ||
      !/^[0-9A-F]{24}$/.test(record.wal_file_name) ||
      typeof record.time !== "string" ||
      record.storage_name !== "default" ||
      typeof record.start_time !== "string" ||
      typeof record.finish_time !== "string" ||
      typeof record.date_fmt !== "string" || record.date_fmt.length === 0 ||
      typeof record.hostname !== "string" || record.hostname.length === 0 ||
      typeof record.data_dir !== "string" || record.data_dir.length === 0 ||
      record.is_permanent !== false
    ) fail();
    canonicalTimestamp(record.time);
    const startedAt = canonicalTimestamp(record.start_time);
    const completedAt = canonicalTimestamp(record.finish_time);
    if (completedAt < startedAt) fail();
    const pgVersion = uint64Token(record.pg_version).integer;
    if (pgVersion / 10_000n !== BigInt(postgresMajor)) fail();
    const start = uint64Token(record.start_lsn).integer;
    const finish = uint64Token(record.finish_lsn).integer;
    if (finish < start) fail();
    const system = uint64Token(record.system_identifier);
    if (system.token !== expectedSystemIdentifier || system.integer === 0n) fail();
    uint64Token(record.uncompressed_size);
    uint64Token(record.compressed_size);
    const timeline = Number.parseInt(record.wal_file_name.slice(0, 8), 16);
    if (!Number.isSafeInteger(timeline) || timeline < 1) fail();
    const derivedStartWal = walSegmentForLsn(timeline, start, walSegmentBytes);
    if (derivedStartWal !== record.wal_file_name) fail();
    return Object.freeze({
      id: selectedBackupId,
      startedAt,
      completedAt,
      startLsn: lsn(start),
      stopLsn: lsn(finish),
      startWalSegment: record.wal_file_name,
      stopWalSegment: walSegmentForLsn(timeline, finish, walSegmentBytes),
      timeline,
      systemIdentifier: system.token,
    });
  } catch (cause) {
    if (cause?.message === ERROR_MESSAGE) throw cause;
    fail();
  }
}
