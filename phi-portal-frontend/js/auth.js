// ---- EDIT THESE FOUR VALUES to match your Cognito + API Gateway setup ----
const CONFIG = {
  cognitoDomain: 'https://us-east-17awekaexe.auth.us-east-1.amazoncognito.com',
  clientId: '1mta46k59jatpnt834s7bqbadr',
  apiBaseUrl: 'https://fbd8ivxugg.execute-api.us-east-1.amazonaws.com',
  redirectUri: 'https://docs.joinabsquare.com/callback.html',
};
// ---------------------------------------------------------------------

const Auth = (() => {
  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function sha256(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64url(new Uint8Array(digest));
  }

  function randomString(len = 64) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return base64url(arr).slice(0, len);
  }

  async function login() {
    const verifier = randomString();
    sessionStorage.setItem('pkce_verifier', verifier);
    const challenge = await sha256(verifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      scope: 'openid email',
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    window.location.href = `${CONFIG.cognitoDomain}/oauth2/authorize?${params}`;
  }

  function storeTokens(tokens) {
    sessionStorage.setItem('id_token', tokens.id_token);
    sessionStorage.setItem('access_token', tokens.access_token);
    // Cognito's authorization-code grant issues a refresh_token by default
    // (as long as the app client's "Refresh token" auth flow is enabled,
    // which is the default). We use it to renew the session silently
    // instead of forcing a full re-login every time the ~1hr id_token
    // expires. Refresh tokens are longer-lived than id/access tokens but
    // are still scoped to this app client and can be revoked from Cognito.
    if (tokens.refresh_token) sessionStorage.setItem('refresh_token', tokens.refresh_token);
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) throw new Error(params.get('error_description') || error);

    const code = params.get('code');
    if (!code) throw new Error('No authorization code in callback URL');
    const verifier = sessionStorage.getItem('pkce_verifier');
    if (!verifier) throw new Error('Sign-in session expired — please try logging in again.');

    const res = await fetch(`${CONFIG.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CONFIG.clientId,
        code,
        redirect_uri: CONFIG.redirectUri,
        code_verifier: verifier,
      }),
    });
    sessionStorage.removeItem('pkce_verifier');
    if (!res.ok) throw new Error('Token exchange failed — the sign-in link may have expired. Please try again.');
    storeTokens(await res.json());
  }

  // Silent renewal using the refresh token. Returns true on success.
  async function refreshTokens() {
    const refreshToken = sessionStorage.getItem('refresh_token');
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${CONFIG.cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CONFIG.clientId,
          refresh_token: refreshToken,
        }),
      });
      if (!res.ok) return false;
      storeTokens(await res.json());
      return true;
    } catch {
      return false;
    }
  }

  function decodeIdToken() {
    const idToken = sessionStorage.getItem('id_token');
    if (!idToken) return null;
    try {
      let base64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4 !== 0) base64 += '='; // restore padding stripped from base64url
      return JSON.parse(decodeURIComponent(escape(atob(base64))));
    } catch {
      return null;
    }
  }

  function getGroups() {
    const claims = decodeIdToken();
    if (!claims) return [];
    const g = claims['cognito:groups'] || [];
    return Array.isArray(g) ? g : [g];
  }

  function isLoggedIn() {
    return !!sessionStorage.getItem('id_token');
  }

  function logout() {
    const cognitoDomain = CONFIG.cognitoDomain;
    const clientId = CONFIG.clientId;
    const logoutUri = CONFIG.redirectUri.replace('/callback.html', '/index.html');
    sessionStorage.clear();
    const params = new URLSearchParams({ client_id: clientId, logout_uri: logoutUri });
    window.location.href = `${cognitoDomain}/logout?${params}`;
  }

  // Wrapper around fetch that attaches the Cognito ID token as a Bearer
  // token, transparently retries once via a silent refresh on a 401, and
  // surfaces network failures as a normal rejected promise (instead of
  // letting callers crash on `undefined.json()`).
  async function apiFetch(path, options = {}) {
    const doFetch = () => {
      const token = sessionStorage.getItem('id_token');
      return fetch(`${CONFIG.apiBaseUrl}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    };

    let res;
    try {
      res = await doFetch();
    } catch {
      throw new Error('Network error — please check your connection and try again.');
    }

    if (res.status === 401) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        try {
          res = await doFetch();
        } catch {
          throw new Error('Network error — please check your connection and try again.');
        }
      }
      if (res.status === 401) {
        logout();
        return null;
      }
    }
    return res;
  }

  return { login, logout, handleCallback, decodeIdToken, getGroups, isLoggedIn, apiFetch };
})();
