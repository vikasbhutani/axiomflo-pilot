import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import { createFirebaseTokenVerifier, TokenRejectedError, TokenVerificationUnavailableError } from './tokenVerifier.js';

const PROJECT = 'axiomflo-pilot';

function decoded(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    uid: 'user-1',
    sub: 'user-1',
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    email: 'person@example.com',
    email_verified: true,
    name: 'Person',
    auth_time: 0,
    iat: 0,
    exp: 0,
    firebase: { identities: {}, sign_in_provider: 'google.com' },
    ...overrides,
  } as DecodedIdToken;
}

function verifierWith(impl: () => Promise<DecodedIdToken>) {
  const verifyIdToken = vi.fn(impl);
  return { verifier: createFirebaseTokenVerifier({ verifyIdToken } as unknown as Auth, PROJECT), verifyIdToken };
}

const firebaseError = (code: string) => Object.assign(new Error(`Firebase said no; token=eyJsecret`), { code });

describe('createFirebaseTokenVerifier', () => {
  it('always asks Firebase to check revocation and disabled accounts', async () => {
    const { verifier, verifyIdToken } = verifierWith(async () => decoded());
    await verifier.verify('a.b.c');
    expect(verifyIdToken).toHaveBeenCalledWith('a.b.c', true);
  });

  it('returns only identity fields taken from the verified token', async () => {
    const { verifier } = verifierWith(async () => decoded());
    expect(await verifier.verify('a.b.c')).toEqual({
      uid: 'user-1',
      email: 'person@example.com',
      emailVerified: true,
      displayName: 'Person',
      signInProvider: 'google.com',
    });
  });

  it('treats a missing email_verified claim as unverified', async () => {
    const { verifier } = verifierWith(async () => decoded({ email_verified: undefined }));
    expect((await verifier.verify('a.b.c')).emailVerified).toBe(false);
  });

  it.each([
    ['auth/id-token-expired', 'expired'],
    ['auth/id-token-revoked', 'revoked'],
    ['auth/user-disabled', 'disabled'],
    ['auth/user-not-found', 'revoked'],
    ['auth/argument-error', 'invalid'],
    ['auth/invalid-id-token', 'invalid'],
  ])('maps %s to a 401 rejection (%s)', async (code, reason) => {
    const { verifier } = verifierWith(async () => {
      throw firebaseError(code);
    });
    await expect(verifier.verify('a.b.c')).rejects.toEqual(new TokenRejectedError(reason as never));
  });

  it('rejects a token issued for another Firebase project, even if the SDK accepted it', async () => {
    for (const bad of [decoded({ aud: 'someone-else' }), decoded({ iss: 'https://securetoken.google.com/someone-else' })]) {
      const { verifier } = verifierWith(async () => bad);
      await expect(verifier.verify('a.b.c')).rejects.toMatchObject({ reason: 'wrong_project' });
    }
  });

  it('reports other failures as unavailable (503), never as valid, and drops the SDK message', async () => {
    const { verifier } = verifierWith(async () => {
      throw firebaseError('auth/internal-error');
    });
    const error = await verifier.verify('a.b.c').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TokenVerificationUnavailableError);
    expect((error as Error).message).not.toContain('eyJsecret');
  });
});
