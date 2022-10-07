/*
npc manager tracks instances of all npcs.
npcs includes,
  - characters in party system
  - world npcs
  - detached npcs for character select preview
*/

import * as THREE from 'three';
import Avatar from './avatars/avatars.js';
import {LocalPlayer} from './character-controller.js';
import {playersManager} from './players-manager.js';
import * as voices from './voices.js';
import {world} from './world.js';
import {chatManager} from './chat-manager.js';
import {makeId, createRelativeUrl} from './util.js';
import { triggerEmote } from './src/components/general/character/Poses.jsx';
import validEmotionMapping from "./validEmotionMapping.json";
import metaversefile from './metaversefile-api.js';
import {runSpeed, walkSpeed} from './constants.js';
import {characterSelectManager} from './characterselect-manager.js';

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();

const updatePhysicsFnMap = new WeakMap();
const updateAvatarsFnMap = new WeakMap();
const cancelFnPerNpc = new WeakMap();
const cancelFnPerApp = new WeakMap();

class NpcManager extends EventTarget {
  constructor() {
    super();

    this.npcs = [];
    this.npcAppMap = new WeakMap();
    this.detachedNpcs = [];
    this.targetMap = new WeakMap();
  }

  getAppByNpc(npc) {
    return this.npcAppMap.get(npc);
  }

  getNpcByApp(app) {
    return this.npcs.find(npc => this.getAppByNpc(npc) === app);
  }

  getDetachedNpcByApp(app) {
    return this.detachedNpcs.find(npc => this.getAppByNpc(npc) === app);
  }

  async initDefaultPlayer() {
    const defaultPlayerSpec = await characterSelectManager.getDefaultSpecAsync();
    const player = metaversefile.useLocalPlayer();
    // console.log('set player spec', defaultPlayerSpec);
    await player.setPlayerSpec(defaultPlayerSpec);

    const createPlayerApp = () => {
      const app = metaversefile.createApp();
      app.instanceId = makeId(5);
      app.name = 'player';
      app.contentId = defaultPlayerSpec.avatarUrl;
      return app;
    };
    const app = createPlayerApp();

    this.addNpc(player, app, defaultPlayerSpec);
    app.addEventListener('destroy', () => {
      const npc = this.getNpcByApp(app);
      this.#removeNpc(npc);
    });

    this.dispatchEvent(new MessageEvent('defaultplayeradd', {
      data: {
        player,
      }
    }));
  }

  async #createNpcAsync({
    name,
    avatarUrl,
    position,
    quaternion,
    scale,
    detached,
    components,
  }) {
    const player = new LocalPlayer({
      npc: true,
      detached,
    });
    player.name = name;

    let matrixNeedsUpdate = false;
    if (position) {
      player.position.copy(position);
      matrixNeedsUpdate = true;
    }
    if (quaternion) {
      player.quaternion.copy(quaternion);
      matrixNeedsUpdate = true;
    }
    if (scale) {
      player.scale.copy(scale);
      matrixNeedsUpdate = true;
    }
    if (matrixNeedsUpdate) {
      player.updateMatrixWorld();
    }

    await player.loadAvatar(avatarUrl, {
      components,
    });
    player.updateAvatar(0, 0);

    return player;
  }

  destroyNpc(npc) {
    npc.destroy();

    this.dispatchEvent(new MessageEvent('playerremove', {
      data: {
        player: npc,
      }
    }));

    const removeIndex = this.npcs.indexOf(npc);
    if (removeIndex !== -1) {
      this.npcs.splice(removeIndex, 1);
    }
  }

  setPartyTarget(player, target) {
    this.targetMap.set(player, target);
  }

  #getPartyTarget(player) {
    return this.targetMap.get(player);
  }

  updatePhysics(timestamp, timeDiff) {
    for (const npc of this.npcs) {
      const fn = updatePhysicsFnMap.get(this.getAppByNpc(npc));
      if (fn) {
        fn(timestamp, timeDiff);
      }
    }
    for (const npc of this.detachedNpcs) {
      const fn = updatePhysicsFnMap.get(this.getAppByNpc(npc));
      if (fn) {
        fn(timestamp, timeDiff);
      }
    }
  }

  updateAvatar(timestamp, timeDiff) {
    for (const npc of this.npcs) {
      const fn = updateAvatarsFnMap.get(this.getAppByNpc(npc));
      if (fn) {
        fn(timestamp, timeDiff);
      }
    }
    for (const npc of this.detachedNpcs) {
      const fn = updateAvatarsFnMap.get(this.getAppByNpc(npc));
      if (fn) {
        fn(timestamp, timeDiff);
      }
    }
  }

  async addNpc(npc, app, json) {
    const appchange = e => {
      // update physics object when vrm app is changed
      app.setPhysicsObject(npc.characterPhysics.characterController);
    };
    npc.addEventListener('appchange', appchange);

    const cleanupFn = () => {
      npc.removeEventListener('appchange', appchange);

      this.destroyNpc(npc);
    };
    cancelFnPerNpc.set(npc, cleanupFn);

    const npcDetached = !!json.detached;
    if (!npcDetached) {
      this.npcs.push(npc);
    } else {
      this.detachedNpcs.push(npc);
    }
    await this.#setPlayerApp(npc, app, json);
  }

  async #setPlayerApp(player, app, json) {
    this.npcAppMap.set(player, app);

    this.dispatchEvent(new MessageEvent('playeradd', {
      data: {
        player,
      }
    }));

    let live = true;
    let character = null;
    const cancelFns = [
      () => {
        live = false;

        if (character) {
          world.loreAIScene.removeCharacter(character);
        }

        this.npcAppMap.delete(player);
      },
    ];
    cancelFnPerApp.set(app, () => {
      for (const cancelFn of cancelFns) {
        cancelFn();
      }
    });

    const animations = Avatar.getAnimations();
    const hurtAnimation = animations.find(a => a.isHurt);
    const hurtAnimationDuration = hurtAnimation.duration;

    app.setPhysicsObject(player.characterPhysics.characterController);
    app.getLoreSpec = () => {
      return {
        name: json.name,
        description: json.bio,
      }
    };

    // events
    let targetSpec = null;
    const _listenEvents = () => {
      const hittrackeradd = e => {
        app.hitTracker.addEventListener('hit', e => {
          if (!player.hasAction('hurt')) {
            const newAction = {
              type: 'hurt',
              animation: 'pain_back',
            };
            player.addAction(newAction);
            
            setTimeout(() => {
              player.removeAction('hurt');
            }, hurtAnimationDuration * 1000);
          }
        });
      };
      app.addEventListener('hittrackeradded', hittrackeradd);
      cancelFns.push(() => {
        app.removeEventListener('hittrackeradded', hittrackeradd);
      });

      const activate = () => {
        if (player.getControlMode() === 'npc') {
          this.dispatchEvent(new MessageEvent('playerinvited', {
            data: {
              player,
            }
          }));
        } else {
          this.dispatchEvent(new MessageEvent('playerexpelled', {
            data: {
              player,
            }
          }));
        }
      };
      app.addEventListener('activate', activate);
      cancelFns.push(() => {
        app.removeEventListener('activate', activate);
      });

      const followTarget = (player, target, timeDiff) => {
        if (target) {
          const v = localVector.setFromMatrixPosition(target.matrixWorld)
            .sub(player.position);
          v.y = 0;
          const distance = v.length();

          const speed = THREE.MathUtils.clamp(
            THREE.MathUtils.mapLinear(
              distance,
              2, 3.5,
              walkSpeed, runSpeed,
            ),
            0, runSpeed,
          );
          const velocity = v.normalize().multiplyScalar(speed);
          player.characterPhysics.applyWasd(velocity, timeDiff);

          return distance;
        }
        return 0;
      };
      const updatePhysicsFn = (timestamp, timeDiff) => {
        if (player) {
          if (player.getControlMode() !== 'controlled') {
            if (player.getControlMode() === 'party') { // if party, follow in a line
              const target = this.#getPartyTarget(player);
              followTarget(player, target, timeDiff);
            } else if (player.getControlMode() === 'npc') {
              if (targetSpec) { // if npc, look to targetSpec
                const target = targetSpec.object;
                const distance = followTarget(player, target, timeDiff);

                if (target) {
                  if (targetSpec.type === 'moveto' && distance < 2) {
                    targetSpec = null;
                  }
                }
              }
            }
            const localPlayer = playersManager.getLocalPlayer();
            player.setTarget(localPlayer.position);
          }

          player.updatePhysics(timestamp, timeDiff);
        }
      };
      const updateAvatarFn = (timestamp, timeDiff) => {
        player.updateAvatar(timestamp, timeDiff);
      };

      updatePhysicsFnMap.set(app, updatePhysicsFn);
      updateAvatarsFnMap.set(app, updateAvatarFn);

      cancelFns.push(() => {
        app.removeEventListener('hittrackeradded', hittrackeradd);
        app.removeEventListener('activate', activate);
        updatePhysicsFnMap.delete(app);
        updateAvatarsFnMap.delete(app);
      });
    };
    _listenEvents();

    // load
    const npcName = json.name;
    const npcVoiceName = json.voice;
    const npcBio = json.bio;
    let npcWear = json.wear ?? [];
    if (!Array.isArray(npcWear)) {
      npcWear = [npcWear];
    }

    // ai scene
    const _addToAiScene = () => {
      character = world.loreAIScene.addCharacter({
        name: npcName,
        bio: npcBio,
      });
      character.addEventListener('say', e => {
        const localPlayer = playersManager.getLocalPlayer();

        const {message, emote, action, object, target} = e.data;
        const chatId = makeId(5);

        const m = {
          type: 'chat',
          chatId,
          playerId: localPlayer.playerId,
          playerName: localPlayer.name,
          message,
        };

        chatManager.addPlayerMessage(npcPlayer, m);
        if (emote !== 'none' && validEmotionMapping[emote]!== undefined) {
          triggerEmote(validEmotionMapping[emote], npcPlayer);
        }
        if (emote === 'supersaiyan' || action === 'supersaiyan' || /supersaiyan/i.test(object) || /supersaiyan/i.test(target)) {
          const newSssAction = {
            type: 'sss',
          };
          npcPlayer.addAction(newSssAction);  
        } else if (action === 'follow' || (object === 'none' && target === localPlayer.name)) { // follow player
          targetSpec = {
            type: 'follow',
            object: localPlayer,
          };
        } else if (action === 'stop') { // stop
          targetSpec = null;
        } else if (action === 'moveto' || (object !== 'none' && target === 'none')) { // move to object
          console.log('move to object', object);
        } else if (action === 'moveto' || (object === 'none' && target !== 'none')) { // move to player
          targetSpec = {
            type: 'moveto',
            object: localPlayer,
          };
        } else if (['pickup', 'grab', 'take', 'get'].includes(action)) { // pick up object
          console.log('pickup', action, object, target);
        } else if (['use', 'activate'].includes(action)) { // use object
          console.log('use', action, object, target);
        }
      });
    };
    _addToAiScene();

    // attach to scene
    const _addPlayerAvatarToApp = () => {
      app.position.set(0, 0, 0);
      app.quaternion.identity();
      app.scale.set(1, 1, 1);

      // app.add(vrmApp);
      app.updateMatrixWorld();
    };
    _addPlayerAvatarToApp();

    // voice endpoint setup
    const _setVoiceEndpoint = () => {
      const voice = voices.voiceEndpoints.find(v => v.name.toLowerCase().replaceAll(' ', '') === npcVoiceName.toLowerCase().replaceAll(' ', ''));
      if (voice) {
        player.setVoiceEndpoint(voice.drive_id);
      } else {
        console.error('*** unknown voice name', npcVoiceName, voices.voiceEndpoints);
      }
    };
    _setVoiceEndpoint();
    // wearables
    const _updateWearables = async () => {
      const wearablePromises = npcWear.map(wear => (async () => {
        const {start_url, components} = wear;
        const app = await player.appManager.addTrackedApp(
          start_url,
          undefined,
          undefined,
          undefined,
          components,
        );
        /* const app = await metaversefile.createAppAsync({
          start_url,
        }); */
        // if (!live) return;

        player.wear(app);
      })());
      await wearablePromises;
    };
    await _updateWearables();
  }

  async addNpcApp(app, srcUrl) {
    let json = null;

    const mode = app.getComponent('mode') ?? 'attached';
    const quality = app.getComponent('quality');

    // load
    if (mode === 'attached') {
      // load json
      const res = await fetch(srcUrl);
      json = await res.json();
      //if (!live) return;

      const npcName = json.name;

      // npc pameters
      let avatarUrl = json.avatarUrl;
      avatarUrl = createRelativeUrl(avatarUrl, srcUrl);

      const npcDetached = !!json.detached;

      const position = localVector.setFromMatrixPosition(app.matrixWorld)
        .add(localVector2.set(0, 1, 0));
      
      // create npc
      const npc = await this.#createNpcAsync({
        name: npcName,
        avatarUrl,
        position,
        quaternion: app.quaternion,
        scale: app.scale,
        detached: npcDetached,
        components: [{
          key: 'quality',
          value: quality,
        }],
      });

      this.addNpc(npc, app, json);
    }
  }
  #removeNpc(npc) {
    const cancelFn = cancelFnPerNpc.get(npc);
    if (cancelFn) {
      cancelFnPerNpc.delete(npc);
      cancelFn();
    }
  }
  removeNpcApp(app) {
    const cancelFn = cancelFnPerApp.get(app);
    if (cancelFn) {
      cancelFnPerApp.delete(app);
      cancelFn();
    }
  }
}
const npcManager = new NpcManager();
export default npcManager;
