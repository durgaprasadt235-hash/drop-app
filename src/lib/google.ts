// DROP — Google Identity Services (GIS) client helper.
// Loads https://accounts.google.com/gsi/client on demand and renders a
// real Google sign-in button. The client ID is a public identifier
// (not a secret) and comes from VITE_GOOGLE_CLIENT_ID, baked in at
// build time from the Vercel environment variable of the same name.
// When it is not set, googleConfigured is false and the UI must show
// "coming soon — credentials needed" instead of rendering a button.

export const googleClientId: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

export const googleConfigured: boolean = googleClientId.length > 0;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number | boolean>,
          ) => void;
        };
      };
    };
  }
}

let gisPromise: Promise<void> | null = null;

export function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window.'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

/**
 * Render the real Google button into `element`. `onCredential` receives
 * the Google ID token (JWT) — send it to /api/auth/google in the POST
 * body, never in a URL. Returns false when Google is not configured.
 */
export async function renderGoogleButton(
  element: HTMLElement,
  onCredential: (idToken: string) => void | Promise<void>,
): Promise<boolean> {
  if (!googleConfigured) return false;
  await loadGis();
  const accounts = window.google?.accounts?.id;
  if (!accounts) return false;
  accounts.initialize({
    client_id: googleClientId,
    callback: (response) => {
      if (response.credential) void onCredential(response.credential);
    },
  });
  element.innerHTML = '';
  accounts.renderButton(element, {
    theme: 'outline',
    size: 'large',
    width: 320,
    text: 'continue_with',
  });
  return true;
}
