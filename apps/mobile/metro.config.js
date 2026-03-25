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
  if (originalResolver) {
    return originalResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
