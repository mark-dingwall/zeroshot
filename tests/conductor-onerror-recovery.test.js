/**
 * Unit test for conductor onError task-text recovery
 *
 * Verifies that all conductor onError hooks use ledger.findLast() to recover
 * the original task text instead of publishing empty strings. Senior conductors
 * must also throw when task text is unrecoverable.
 *
 * Bug context: code-review-conductor and docs-review-conductor previously used
 * static config with empty taskText/"text" in onError hooks. doc-draft-conductor
 * already had the correct pattern; this was adopted for the other two.
 */

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const CONDUCTORS = [
  {
    file: 'code-review-conductor.json',
    junior: 'junior-review-conductor',
    senior: 'senior-review-conductor',
  },
  {
    file: 'docs-review-conductor.json',
    junior: 'junior-review-conductor',
    senior: 'senior-review-conductor',
  },
  {
    file: 'doc-draft-conductor.json',
    junior: 'junior-doc-conductor',
    senior: 'senior-doc-conductor',
  },
];

describe('Conductor onError Task-Text Recovery', function () {
  const configs = {};

  before(function () {
    for (const c of CONDUCTORS) {
      const configPath = path.join(__dirname, '..', 'cluster-templates', c.file);
      configs[c.file] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  });

  for (const { file, junior, senior } of CONDUCTORS) {
    describe(file, function () {
      it('junior onError should use transform (not static config)', function () {
        const config = configs[file];
        const agent = config.agents.find((a) => a.id === junior);
        expect(agent, `${junior} agent exists`).to.exist;

        const onError = agent.hooks?.onError;
        expect(onError, 'onError hook exists').to.exist;
        expect(onError.transform, 'onError uses transform (not static config)').to.exist;
        expect(onError.config, 'onError does not use static config').to.not.exist;
      });

      it('junior onError should query ledger for task text', function () {
        const config = configs[file];
        const agent = config.agents.find((a) => a.id === junior);
        const script = agent.hooks.onError.transform.script;

        expect(script, 'Script queries ledger for ISSUE_OPENED').to.include(
          "ledger.findLast({ topic: 'ISSUE_OPENED' })"
        );
        expect(script, 'Script extracts text from ledger result').to.include(
          'original?.content?.text'
        );
      });

      it('senior onError should use transform (not static config)', function () {
        const config = configs[file];
        const agent = config.agents.find((a) => a.id === senior);
        expect(agent, `${senior} agent exists`).to.exist;

        const onError = agent.hooks?.onError;
        expect(onError, 'onError hook exists').to.exist;
        expect(onError.transform, 'onError uses transform (not static config)').to.exist;
        expect(onError.config, 'onError does not use static config').to.not.exist;
      });

      it('senior onError should query ledger and abort if unrecoverable', function () {
        const config = configs[file];
        const agent = config.agents.find((a) => a.id === senior);
        const script = agent.hooks.onError.transform.script;

        expect(script, 'Script queries ledger for ISSUE_OPENED').to.include(
          "ledger.findLast({ topic: 'ISSUE_OPENED' })"
        );
        expect(script, 'Script throws on empty task text').to.include('throw new Error');
      });

      it('senior onError should republish recovered task text (not empty string)', function () {
        const config = configs[file];
        const agent = config.agents.find((a) => a.id === senior);
        const script = agent.hooks.onError.transform.script;

        // Must NOT contain a literal empty text publish
        expect(script, 'Script does not publish empty text').to.not.include("text: '' }");
        expect(script, 'Script does not publish empty text').to.not.include('"text": ""');

        // Must reference taskText variable in the publish operation
        expect(script, 'Script uses taskText variable in publish').to.include('text: taskText');
      });
    });
  }
});
