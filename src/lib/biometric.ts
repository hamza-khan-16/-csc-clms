/**
 * WebAuthn biometric helper for CSC CLMS
 * Works in Chrome/Safari (mobile browsers) and Median (GoNative) Android APK via WebView.
 *
 * Flow:
 *  1. First login → password form → on success → FORCE biometric registration
 *  2. Subsequent logins → fingerprint only (password form hidden)
 *  3. Session expired → biometric verify → re-ask password → re-register
 *
 * Median APK note:
 *  - Median WebView uses Android System WebView which supports WebAuthn (FIDO2) on Android 9+
 *  - rpId must match the actual hostname of the deployed site (not localhost)
 *  - We store credId + user in localStorage (persists across WebView reloads in Median)
 *  - Supabase session tokens are also in localStorage by default → persists fine
 */

// Detect Median (GoNative) WebView
export function isMedianApp(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as any).median ||
    (window as any).gonative ||
    navigator.userAgent.includes("GoNativeAndroid") ||
    navigator.userAgent.includes("median")
  );
}

// Use actual hostname — critical for Median APK (must match deployed domain)
function getRpId(): string {
  if (typeof window === "undefined") return "localhost";
  const host = window.location.hostname;
  // Strip 'www.' prefix if present
  return host.startsWith("www.") ? host.slice(4) : host;
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function fromB64url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
}

const CRED_KEY = "csc_bio_cred_v2";
const USER_KEY = "csc_bio_user_v2";

export function isBiometricSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
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
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearBiometric(): void {
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Register device biometric after first successful password login.
 * Returns true on success, false if user cancels or device doesn't support it.
 */
export async function registerBiometric(
  identifier: string,
  displayName: string
): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    const userId = new TextEncoder().encode(identifier.slice(0, 64));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rpId = getRpId();

    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId, name: "CSC Leave Management" },
        user: { id: userId, name: identifier, displayName },
        challenge,
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256
          { type: "public-key", alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!cred) return false;

    localStorage.setItem(CRED_KEY, b64url(cred.rawId));
    localStorage.setItem(USER_KEY, JSON.stringify({ identifier, name: displayName }));
    return true;
  } catch (err) {
    console.warn("[biometric] register failed:", err);
    return false;
  }
}

/**
 * Verify biometric. Returns true if the device authenticator accepts the user.
 */
export async function verifyBiometric(): Promise<boolean> {
  const credId = getBiometricCredId();
  if (!credId) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rpId = getRpId();

    const assertion = (await navigator.credentials.get({
      publicKey: {
        rpId,
        challenge,
        allowCredentials: [{ type: "public-key", id: fromB64url(credId) }],
        userVerification: "required",
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    return !!assertion;
  } catch (err) {
    console.warn("[biometric] verify failed:", err);
    return false;
  }
}
