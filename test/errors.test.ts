import { describe, expect, it } from 'vitest';
import { describeNetworkError } from '../src/errors.ts';

function withCode(error: Error, code: string): Error {
  return Object.assign(error, { code });
}

describe('describeNetworkError', () => {
  it('prefixes a code that the message does not contain', () => {
    expect(describeNetworkError(withCode(new Error('self-signed certificate'), 'DEPTH_ZERO_SELF_SIGNED_CERT'))).toBe(
      'DEPTH_ZERO_SELF_SIGNED_CERT self-signed certificate',
    );
    expect(describeNetworkError(withCode(new Error('getaddrinfo ENOTFOUND x.invalid'), 'ENOTFOUND'))).toBe(
      'getaddrinfo ENOTFOUND x.invalid',
    );
  });

  it('lists the attempts of an AggregateError with an empty message', () => {
    const error = withCode(
      new AggregateError([
        new Error('connect ETIMEDOUT 192.0.2.1:443'),
        new Error('connect EHOSTUNREACH 2001:db8::1:443'),
      ]),
      'ETIMEDOUT',
    );
    expect(describeNetworkError(error)).toBe('connect ETIMEDOUT 192.0.2.1:443; connect EHOSTUNREACH 2001:db8::1:443');
  });

  it('never returns an empty string', () => {
    expect(describeNetworkError(withCode(new AggregateError([]), 'ETIMEDOUT'))).toBe('ETIMEDOUT');
    expect(describeNetworkError(new Error(''))).toBe('Error');
    expect(describeNetworkError('plain')).toBe('plain');
  });
});
