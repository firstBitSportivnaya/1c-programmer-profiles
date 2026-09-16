"use strict";

function Database() {
  throw new Error("native better-sqlite3 is not used; SQLite goes through node:sqlite");
}

module.exports = Database;
