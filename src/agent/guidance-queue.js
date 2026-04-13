const GUIDANCE_BLOCK_START = '<<GUIDANCE_QUEUE_START>>';
const GUIDANCE_BLOCK_END = '<<GUIDANCE_QUEUE_END>>';

function formatGuidanceMessage(message) {
  const d = Number.isFinite(message.timestamp) ? new Date(message.timestamp) : new Date();
  const timestamp = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sender = message.sender || 'unknown';
  const topic = message.topic || 'GUIDANCE';
  const target = message.receiver || message.target_agent_id;
  const targetSuffix = target ? ` -> ${target}` : '';

  let formatted = `[${timestamp}] ${sender} (${topic}${targetSuffix})\n`;
  if (message.content?.text) {
    formatted += `${message.content.text}\n`;
  }
  if (message.content?.data) {
    formatted += `${JSON.stringify(message.content.data)}\n`;
  }

  return formatted.trimEnd();
}

function formatGuidanceBlock(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const ordered = messages.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  let block = '## Guidance (Queued)\n\n';
  block += `${GUIDANCE_BLOCK_START}\n`;

  ordered.forEach((message, index) => {
    block += `${formatGuidanceMessage(message)}\n`;
    if (index < ordered.length - 1) {
      block += '\n';
    }
  });

  block += `\n${GUIDANCE_BLOCK_END}\n\n`;
  return block;
}

function collectQueuedGuidance({ messageBus, clusterId, agentId, lastDeliveredAt, limit }) {
  if (!messageBus) {
    throw new Error('collectQueuedGuidance: messageBus is required');
  }
  if (!clusterId) {
    throw new Error('collectQueuedGuidance: clusterId is required');
  }
  if (!agentId) {
    throw new Error('collectQueuedGuidance: agentId is required');
  }

  const messages = messageBus.queryGuidanceMailbox({
    cluster_id: clusterId,
    target_agent_id: agentId,
    lastDeliveredAt,
    limit,
  });

  if (!messages.length) {
    return { messages: [], latestTimestamp: null, guidanceBlock: '' };
  }

  const ordered = messages.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const latestTimestamp = ordered[ordered.length - 1].timestamp;
  const guidanceBlock = formatGuidanceBlock(ordered);

  return { messages: ordered, latestTimestamp, guidanceBlock };
}

module.exports = {
  GUIDANCE_BLOCK_START,
  GUIDANCE_BLOCK_END,
  formatGuidanceBlock,
  collectQueuedGuidance,
};
