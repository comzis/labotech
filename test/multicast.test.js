'use strict';

const { MulticastForwarder, isInSubnet } = require('../src/multicast-forward');

describe('isInSubnet', () => {
  test('accepts valid address in /26', () => {
    expect(isInSubnet('239.100.25.1',  '239.100.25.0/26')).toBe(true);
    expect(isInSubnet('239.100.25.29', '239.100.25.0/26')).toBe(true);
    expect(isInSubnet('239.100.25.63', '239.100.25.0/26')).toBe(true);
  });

  test('rejects address outside /26', () => {
    expect(isInSubnet('239.100.25.64',  '239.100.25.0/26')).toBe(false);
    expect(isInSubnet('239.100.25.128', '239.100.25.0/26')).toBe(false);
    expect(isInSubnet('239.100.26.1',   '239.100.25.0/26')).toBe(false);
    expect(isInSubnet('10.0.0.1',       '239.100.25.0/26')).toBe(false);
  });

  test('accepts entire /24', () => {
    expect(isInSubnet('192.168.1.100', '192.168.1.0/24')).toBe(true);
    expect(isInSubnet('192.168.2.1',   '192.168.1.0/24')).toBe(false);
  });

  test('handles /32 exactly', () => {
    expect(isInSubnet('239.100.25.29', '239.100.25.29/32')).toBe(true);
    expect(isInSubnet('239.100.25.30', '239.100.25.29/32')).toBe(false);
  });
});

describe('MulticastForwarder', () => {
  const baseOpts = {
    id: 'fwd-test',
    sourceUrl: 'udp://239.0.0.1:5000',
    destIp: '239.100.25.10',
    destPort: 1234,
    nic: 'eno2',
    subnet: '239.100.25.0/26',
  };

  test('creates forwarder', () => {
    const f = new MulticastForwarder(baseOpts);
    expect(f.id).toBe('fwd-test');
    expect(f.isRunning).toBe(false);
  });

  test('buildMulticastUrl includes destIp and port', () => {
    const f = new MulticastForwarder(baseOpts);
    const url = f.buildMulticastUrl();
    expect(url).toContain('239.100.25.10');
    expect(url).toContain('1234');
  });

  test('buildMulticastUrl includes pkt_size=1316', () => {
    const f = new MulticastForwarder(baseOpts);
    expect(f.buildMulticastUrl()).toContain('pkt_size=1316');
  });

  test('validateDestination throws for out-of-subnet address', () => {
    const f = new MulticastForwarder({ ...baseOpts, destIp: '239.100.26.1' });
    expect(() => f.validateDestination()).toThrow(/subnet/);
  });

  test('validateDestination passes for valid address', () => {
    const f = new MulticastForwarder(baseOpts);
    expect(() => f.validateDestination()).not.toThrow();
  });

  test('validateDestination enforces strict allowedIp when configured', () => {
    const strict = new MulticastForwarder({ ...baseOpts, allowedIp: '239.100.25.29' });
    expect(() => strict.validateDestination()).toThrow(/Only 239\.100\.25\.29 is allowed/);

    const strictAllowed = new MulticastForwarder({ ...baseOpts, destIp: '239.100.25.29', allowedIp: '239.100.25.29' });
    expect(() => strictAllowed.validateDestination()).not.toThrow();
  });

  test('validateNic rejects unsafe interface names', () => {
    const f = new MulticastForwarder({ ...baseOpts, nic: 'eno2;rm -rf /' });
    expect(() => f.validateNic()).toThrow(/Invalid NIC name/);
  });

  test('toJSON returns correct fields', () => {
    const f = new MulticastForwarder(baseOpts);
    const j = f.toJSON();
    expect(j.id).toBe('fwd-test');
    expect(j.destIp).toBe('239.100.25.10');
    expect(j.isRunning).toBe(false);
  });
});
