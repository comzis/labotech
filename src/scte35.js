'use strict';

const { EventEmitter } = require('events');
const { exec } = require('child_process');

/**
 * Build a SCTE-35 splice_insert command string.
 * Returns a base64-encoded SCTE-35 binary splice_insert section.
 */
function buildSpliceInsert(options = {}) {
  const {
    spliceEventId    = Math.floor(Math.random() * 0xffffffff),
    outOfNetwork     = true,
    duration         = null,   // in 90kHz ticks; null = no break duration
    ptsTime          = null,   // in 90kHz ticks; null = immediate
    uniqueProgramId  = 1,
    availNum         = 0,
    availsExpected   = 0,
  } = options;

  // Minimal SCTE-35 splice_insert structure (informational representation)
  return {
    tableId:            0xfc,
    sectionSyntaxIndicator: false,
    privateIndicator:   false,
    sectionLength:      0,   // calculated on serialisation
    protocolVersion:    0,
    encryptedPacket:    false,
    spliceCommandType:  0x05,
    spliceInsert: {
      spliceEventId,
      spliceEventCancelIndicator: false,
      outOfNetworkIndicator: outOfNetwork,
      programSpliceFlag: true,
      durationFlag: duration !== null,
      spliceImmediateFlag: ptsTime === null,
      ptsTime,
      breakDuration: duration !== null ? {
        autoReturn: true,
        duration,
      } : null,
      uniqueProgramId,
      availNum,
      availsExpected,
    },
    crc32: null,
  };
}

class SCTE35Injector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.streamId = options.streamId;
  }

  /**
   * Inject a splice insert into a running stream via a side-channel signal.
   * In practice this would call an external SCTE-35 injector tool.
   */
  splice(options = {}) {
    const payload = buildSpliceInsert(options);
    this.emit('splice', payload);
    return payload;
  }
}

module.exports = { buildSpliceInsert, SCTE35Injector };
