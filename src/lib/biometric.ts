// WebAuthn-based biometric / device-lock authentication
// Uses the platform authenticator (fingerprint, Face ID, or device PIN/pattern as fallback)

const RP_ID = typeof window !== "undefined" ? window.location.hostname : "localhost";
const CRED_KEY = "csc_biometric_cred_id";
const USER_KEY = "csc_biometric_user";

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromB64url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function isBiometricSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    typeof navigator.credentials?.create === "function"
  );
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function getBiometricCredId(): string | null {
  return localStorage.getItem(CRED_KEY);
}

export function getBiometricUser(): { identifier: string; name: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function clearBiometric() {
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(USER_KEY);
}

// Called once after a successful password sign-in to register the credential
export async function registerBiometric(identifier: string, displayName: string): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    const userId = new TextEncoder().encode(identifier);
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { id: RP_ID, name: "CSC Leave Management" },
        user: { id: userId, name: identifier, displayName },
        challenge,
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },  // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    if (!cred) return false;
    localStorage.setItem(CRED_KEY, b64url(cred.rawId));
    localStorage.setItem(USER_KEY, JSON.stringify({ identifier, name: displayName }));
    return true;
  } catch {
    return false;
  }
}

// Called on sign-in page to verify via biometric
export async function verifyBiometric(): Promise<boolean> {
  const credId = getBiometricCredId();
  if (!credId) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        rpId: RP_ID,
        challenge,
        allowCredentials: [
          { type: "public-key", id: fromB64url(credId) },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    return !!assertion;
  } catch {
    return false;
  }
}
