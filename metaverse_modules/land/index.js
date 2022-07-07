// import * as THREE from 'three';
import metaversefile from 'metaversefile';
const {useApp, useCleanup} = metaversefile;

export default e => {
  const app = useApp();

  app.name = 'land';

  const landApps = [
    {
      "start_url": "https://webaverse.github.io/dual-contouring-terrain/"
    },
    {
      "start_url": "https://webaverse.github.io/silk-grass/"
    },
    {
      "start_url": "https://webaverse.github.io/plants/"
    },
    {
      "start_url": "/metaverse_modules/spawner/",
      "components": [
        {
          "key": "appUrls",
          "value": [
            "https://webaverse.github.io/ghost/",
            "https://webaverse.github.io/silkworm-biter/",
            "https://webaverse.github.io/silkworm-bloater/",
            "https://webaverse.github.io/silkworm-queen/",
            "https://webaverse.github.io/silkworm-runner/",
            "https://webaverse.github.io/silkworm-slasher/"
          ],
        },
      ],
    },
  ];
  const passComponents = [];
  const seed = app.getComponent('seed');
  const clipRange = app.getComponent('clipRange');
  const wait = app.getComponent('wait');
  const debug = app.getComponent('debug');

  const renderPosition = app.getComponent('renderPosition');
  if (renderPosition !== undefined) {
    passComponents.push({
      "key": "renderPosition",
      "value": renderPosition,
    });
  }
  const minLodRange = app.getComponent('minLodRange');
  if (minLodRange !== undefined) {
    passComponents.push({
      "key": "minLodRange",
      "value": minLodRange,
    });
  }
  const lods = app.getComponent('lods');
  if (lods !== undefined) {
    passComponents.push({
      "key": "lods",
      "value": lods,
    });
  }
  if (seed !== undefined) {
    passComponents.push({
      "key": "seed",
      "value": seed,
    });
  }
  if (clipRange !== undefined) {
    passComponents.push({
      "key": "clipRange",
      "value": clipRange,
    });
  }
  if (wait !== undefined) {
    passComponents.push({
      "key": "wait",
      "value": wait,
    });
  }
  if (debug !== undefined) {
    passComponents.push({
      "key": "debug",
      "value": debug,
    });
  }

  console.log('land components', app.components);

  const subApps = [];
  const loadPromise = (async () => {
    await Promise.all(landApps.map(async spec => {
      const {start_url, components} = spec;
      const components2 = (components ?? []).concat(passComponents);
      const subApp = await metaversefile.createAppAsync({
        start_url,
        parent: app,
        components: components2,
      });
      subApps.push(subApp);
    }));
  })();
  if (wait) {
    e.waitUntil(loadPromise);
  }

  app.getPhysicsObjects = () => {
    const result = [];
    for (const subApp of subApps) {
      const physicsObjects = subApp.getPhysicsObjects();
      result.push(...physicsObjects);
    }
    return result;
  };

  useCleanup(() => {
    for (const subApp of subApps) {
      subApp.destroy();
    }
  });

  return app;
};