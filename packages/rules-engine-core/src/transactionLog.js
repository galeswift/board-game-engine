'use strict';

// Nothing fancy - a debugging/inspection helper over the flat
// {kind, command|event}[] log engine.js's execute() appends to. Not
// used for replay (replay works from the action log, not this log) -
// this exists so a caller (or a future dev endpoint) can print what
// actually happened during one action without reaching into command/
// event payload shapes by hand.
function summarize(log) {
  return log.map((entry) =>
    entry.kind === 'command' ? { kind: 'command', type: entry.command.type } : { kind: 'event', type: entry.event.type }
  );
}

module.exports = { summarize };
