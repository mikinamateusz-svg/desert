const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch monorepo root so Metro resolves workspace packages (@desert/types etc.)
config.watchFolders = [workspaceRoot];

// Resolve workspace packages from monorepo node_modules first
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// @rnmapbox/maps imports mapbox-gl (and its CSS) on web — stub both out since this is a mobile-only app
const originalResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'mapbox-gl' || moduleName.startsWith('mapbox-gl/'))
  ) {
    return { type: 'empty' };
  }

  const delegate = originalResolver
    ? () => originalResolver(context, moduleName, platform)
    : () => context.resolveRequest(context, moduleName, platform);

  try {
    return delegate();
  } catch (err) {
    // NodeNext-style imports use a literal `.js` extension for what is actually
    // a `.ts` source file (so the emitted output has correct ESM extensions).
    // The api compiles via tsc which understands this; Metro's resolver does
    // not — it looks for a literal `.js` and gives up. Re-try without the
    // extension so Metro's standard order (.ts, .tsx, .android.ts, …) picks
    // the source. Only fires on a miss, so genuine `.js` imports that resolve
    // correctly never take this path.
    if (
      moduleName.startsWith('.') &&
      moduleName.endsWith('.js') &&
      !moduleName.endsWith('.android.js') &&
      !moduleName.endsWith('.native.js')
    ) {
      const stripped = moduleName.slice(0, -3);
      const retry = originalResolver
        ? () => originalResolver(context, stripped, platform)
        : () => context.resolveRequest(context, stripped, platform);
      return retry();
    }
    throw err;
  }
};

module.exports = config;
