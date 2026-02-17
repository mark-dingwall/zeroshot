/**
 * Shared ledger helpers for doc-draft workflow scripts.
 * Extracts common SQLite operations used by assemble-doc.js and build-revision-context.js.
 */

const path = require('path');
const os = require('os');

function openLedger(clusterId) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(os.homedir(), '.zeroshot', `${clusterId}.db`);
  return new Database(dbPath, { readonly: true });
}

function queryMessages(db, clusterId, topic, sender) {
  let sql = 'SELECT * FROM messages WHERE cluster_id = ? AND topic = ?';
  const params = [clusterId, topic];
  if (sender) {
    sql += ' AND sender = ?';
    params.push(sender);
  }
  sql += ' ORDER BY timestamp ASC';
  return db.prepare(sql).all(params);
}

function deserializeContent(row) {
  let data = {};
  if (row.content_data) {
    try {
      data = JSON.parse(row.content_data);
    } catch (err) {
      throw new Error(
        `Corrupt content_data in message (sender=${row.sender}, topic=${row.topic}, ` +
          `timestamp=${row.timestamp}): ${err.message}`
      );
    }
  }
  return {
    text: row.content_text || '',
    data,
    sender: row.sender,
    timestamp: row.timestamp,
  };
}

module.exports = { openLedger, queryMessages, deserializeContent };
