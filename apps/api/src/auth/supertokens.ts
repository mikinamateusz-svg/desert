import SuperTokens from 'supertokens-node';
import ThirdParty from 'supertokens-node/recipe/thirdparty/index.js';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import Session from 'supertokens-node/recipe/session/index.js';

export function initSuperTokens(connectionUri: string, apiKey: string) {
  SuperTokens.init({
    framework: 'custom',
    supertokens: { connectionURI: connectionUri, apiKey },
    appInfo: {
      appName: 'desert',
      apiDomain: process.env['API_URL'] ?? 'http://localhost:3000',
      websiteDomain: process.env['WEB_URL'] ?? 'http://localhost:3001',
      apiBasePath: '/v1/auth',
    },
    recipeList: [
      ThirdParty.init(), // no providers — uses manuallyCreateOrUpdateUser
      EmailPassword.init(),
      Session.init({ getTokenTransferMethod: () => 'header' }),
    ],
  });
}
