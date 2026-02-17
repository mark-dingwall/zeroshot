/**
 * Tests for shared ledger-helpers (H1 fix: guarded JSON.parse).
 */

const assert = require('assert');
const { deserializeContent } = require('../scripts/lib/ledger-helpers');

describe('deserializeContent', function () {
  it('parses valid JSON content_data', function () {
    const row = {
      content_data: '{"approved": true, "sectionReviews": []}',
      content_text: 'All good',
      sender: 'validator-completeness',
      timestamp: 1000,
    };
    const result = deserializeContent(row);

    assert.strictEqual(result.text, 'All good');
    assert.strictEqual(result.data.approved, true);
    assert.deepStrictEqual(result.data.sectionReviews, []);
    assert.strictEqual(result.sender, 'validator-completeness');
    assert.strictEqual(result.timestamp, 1000);
  });

  it('throws with context on corrupt JSON content_data', function () {
    const row = {
      content_data: '{invalid json!!!',
      content_text: '',
      sender: 'drafter',
      topic: 'DRAFT_READY',
      timestamp: 2000,
    };

    assert.throws(
      () => deserializeContent(row),
      (err) => {
        assert.ok(
          err.message.includes('Corrupt content_data'),
          `Should mention corruption: ${err.message}`
        );
        assert.ok(err.message.includes('sender=drafter'), `Should include sender: ${err.message}`);
        assert.ok(
          err.message.includes('topic=DRAFT_READY'),
          `Should include topic: ${err.message}`
        );
        assert.ok(
          err.message.includes('timestamp=2000'),
          `Should include timestamp: ${err.message}`
        );
        return true;
      }
    );
  });

  it('returns empty data for null content_data', function () {
    const row = {
      content_data: null,
      content_text: 'text only',
      sender: 'system',
      timestamp: 3000,
    };
    const result = deserializeContent(row);

    assert.deepStrictEqual(result.data, {});
    assert.strictEqual(result.text, 'text only');
  });

  it('returns empty data for undefined content_data', function () {
    const row = {
      content_text: '',
      sender: 'system',
      timestamp: 4000,
    };
    const result = deserializeContent(row);

    assert.deepStrictEqual(result.data, {});
  });

  it('returns empty string for missing content_text', function () {
    const row = {
      content_data: '{"key": "value"}',
      sender: 'agent',
      timestamp: 5000,
    };
    const result = deserializeContent(row);

    assert.strictEqual(result.text, '');
    assert.strictEqual(result.data.key, 'value');
  });
});
