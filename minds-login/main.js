// Hello Minds sign-in for Kult Sports (Minds Connect, OAuth 2.1 + PKCE).
//
// Built separately like the Privy island (npm run build → public/minds/kult-minds.js)
// and loaded only when config.json has a mindsClientId. It exposes:
//
//   const minds = init({ clientId, redirectUri })
//   await minds.signIn()               leaves for Hello Minds; comes back to redirectUri
//   await minds.handleRedirect(search) finishes sign-in on return (code + state from the URL)
//   await minds.accessToken()          a fresh access token, or null when signed out
//   await minds.signOut()
//
// The access token is only ever sent to the Kult Sports API, which proves it
// against Hello Minds to link the player's Mind (POST /v1/agency/mind).

import { MindsOAuth, MindsScope } from "@animocabrands/minds-connect";

export function init({ clientId, redirectUri }) {
  const oauth = new MindsOAuth({ clientId, redirectUri, scopes: [MindsScope.Email, MindsScope.MindsList] });
  return {
    signIn: () => oauth.signIn(),
    handleRedirect: (search) => oauth.handleRedirect(search),
    accessToken: () => oauth.getAccessToken(),
    signOut: () => oauth.signOut()
  };
}
