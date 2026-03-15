let _authClient = null;
let _authConfig = null;
let _user = null;

function el(id) {
  return document.getElementById(id);
}

async function fetchAuthConfig() {
  const response = await fetch("/auth/config");
  if (!response.ok) {
    throw new Error("Could not load Auth0 configuration.");
  }
  return response.json();
}

function showLogin(message = "") {
  el("login-screen")?.classList.remove("hidden");
  el("app")?.classList.add("hidden");
  const msg = el("auth-login-message");
  if (!msg) return;
  if (message) {
    msg.textContent = message;
    msg.classList.remove("hidden");
  } else {
    msg.textContent = "";
    msg.classList.add("hidden");
  }
}

function showApp() {
  el("login-screen")?.classList.add("hidden");
  el("app")?.classList.remove("hidden");
}

function updateAuthenticatedUi() {
  const userChip = el("auth-user");
  const logoutButton = el("btn-logout");
  if (userChip) {
    userChip.textContent = _user?.name || _user?.email || "Signed in";
    userChip.classList.remove("hidden");
  }
  logoutButton?.classList.remove("hidden");
}

export async function initializeAuth() {
  try {
    _authConfig = await fetchAuthConfig();
  } catch (error) {
    showLogin(error.message || "Auth configuration is unavailable.");
    return false;
  }

  if (!_authConfig.domain || !_authConfig.clientId) {
    showLogin("Auth0 is not configured yet. Add the Auth0 environment variables to start the app.");
    return false;
  }

  if (!window.auth0?.createAuth0Client) {
    showLogin("The Auth0 SDK did not load.");
    return false;
  }

  _authClient = await window.auth0.createAuth0Client({
    domain: _authConfig.domain,
    clientId: _authConfig.clientId,
    authorizationParams: {
      redirect_uri: window.location.origin,
      audience: _authConfig.audience || undefined,
    },
    cacheLocation: "localstorage",
  });

  const params = new URLSearchParams(window.location.search);
  if (params.has("code") && params.has("state")) {
    await _authClient.handleRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const isAuthenticated = await _authClient.isAuthenticated();
  if (!isAuthenticated) {
    showLogin();
    return false;
  }

  _user = await _authClient.getUser();
  updateAuthenticatedUi();
  showApp();
  return true;
}

export async function login() {
  if (!_authClient) return;
  await _authClient.loginWithRedirect({
    authorizationParams: {
      redirect_uri: window.location.origin,
      audience: _authConfig?.audience || undefined,
    },
  });
}

export async function signup() {
  if (!_authClient) return;
  await _authClient.loginWithRedirect({
    authorizationParams: {
      redirect_uri: window.location.origin,
      audience: _authConfig?.audience || undefined,
      screen_hint: "signup",
    },
  });
}

export function logout() {
  if (!_authClient) return;
  _authClient.logout({
    logoutParams: {
      returnTo: window.location.origin,
    },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  el("btn-login")?.addEventListener("click", () => {
    void login();
  });
  el("btn-signup")?.addEventListener("click", () => {
    void signup();
  });
  el("btn-signup-top")?.addEventListener("click", () => {
    void signup();
  });
  el("btn-logout")?.addEventListener("click", logout);
});
