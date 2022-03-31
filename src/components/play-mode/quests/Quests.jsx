import * as THREE from 'three';
import React, {useState, useRef, useEffect} from 'react';
// import classnames from 'classnames';
import styles from './quests.module.css';
import {rootScene, scene} from '../../../../renderer.js';
import {screenshotScene} from '../../../../scene-screenshotter.js';
import questManager from '../../../../quest-manager.js';
import {Spritesheet} from '../../general/spritesheet';
import metaversefile from 'metaversefile';
// import spritesheetManager from '../../../../spritesheet-manager.js';
// import alea from '../../../../procgen/alea.js';

const screenshotSize = 150;

const size = 2048;
const numFrames = 128;
const numFramesPow2 = Math.pow(2, Math.ceil(Math.log2(numFrames)));
const numFramesPerRow = Math.ceil(Math.sqrt(numFramesPow2));
const frameSize = size / numFramesPerRow;
const frameLoopTime = 2000;
const frameTime = frameLoopTime / numFrames;

export const Drop = ({
    drop,
    enabled,
}) => {
    const {name, quantity, start_url} = drop;

    return (
        <div className={ styles.drop }>
            <Spritesheet
                className={styles.canvas}
                startUrl={start_url}
                enabled={enabled}
                size={size}
                numFrames={numFrames}
            />

            <div className={ styles.quantity }>{quantity}</div>
            <div className={ styles.name }>{name}</div>
        </div>
    );
};
export const Quest = ({
    quest,
    enabled,
}) => {
    const canvasRef = useRef();

    const {name, description} = quest;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            /* const infoboxRenderer = loadoutManager.getInfoboxRenderer();
            infoboxRenderer.addCanvas(canvas); */

            const ctx = canvas.getContext('2d');

            /* const canvas2 = document.createElement('canvas');
            canvas2.style.cssText = `\
                position: fixed;
                top: 100px;
                left: 100px;
                width: ${300}px;
                height: ${300}px;
                background-color: #F00;
            `;
            canvas2.width = screenshotSize;
            canvas2.height = screenshotSize;
            const ctx2 = canvas2.getContext('2d');
            // ctx2.drawImage(imageBitmap, 0, 0);
            document.body.appendChild(canvas2); */

            let live = true;
            let timeout = null;
            (async () => {
                await metaversefile.waitForSceneLoaded();
                if (!live) return;

                const _recurse = () => {
                    (async () => {
                        const position = new THREE.Vector3(0, 30, 0);
                        const quaternion = new THREE.Quaternion()
                          .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 4);
                        // console.log('screenshot scene 1');
                        screenshotScene(scene, position, quaternion, screenshotSize, ctx);
                        // console.log('screenshot scene 2', imageBitmap, live);
                        // if (!live) return;
    
                        // ctx.fillStyle = '#F00';
                        // ctx.fillRect(0, 0, canvas.width, canvas.height);
                        // ctx.drawImage(imageBitmap, 0, 0);
    
                        // console.log('screenshot scene 3', imageBitmap);
                    })();

                    timeout = setTimeout(_recurse, 100);
                };
                timeout = setTimeout(_recurse, 100);
            })();

            return () => {
                live = false;
                clearTimeout(timeout);
            };
        }
    }, [canvasRef]);

    return (
        <div className={ styles.quest } >
            <div className={ styles.background } />
            <canvas className={ styles.screenshot } width={screenshotSize} height={screenshotSize} ref={canvasRef} />
            <div className={ styles.content }>
                <h1 className={ styles.heading }>{name}</h1>
                <div className={ styles.description }>{description}</div>
                <div className={ styles.drops }>
                    {quest.drops.map((drop, i) => {
                        return (
                            <Drop
                                drop={drop}
                                enabled={enabled}
                                key={i}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );

};
export const Quests = () => {
    const [ enabled, setEnabled ] = useState(true);
    const [ quests, setQuests ] = useState(() => questManager.quests.slice());

    useEffect(() => {
        const questadd = e => {
            const {quest} = e.data;
            setQuests(quests.concat([quest]));
        };
        questManager.addEventListener('questadd', questadd);
        const questremove = e => {
            const {quest} = e.data;
            const index = quests.indexOf(quest);
            if (index !== -1) {
                const newQuests = quests.slice();
                newQuests.splice(index, 1);
                setQuests(newQuests);
            }
        };
        questManager.addEventListener('questremove', questremove);
        return () => {
            questManager.removeEventListener('questadd', questadd);
            questManager.removeEventListener('questremove', questremove);
        };
    }, [quests]);
    useEffect(() => {
        const quest = {
            name: 'Blob destruction',
            description: 'Destroy all blobs in the area',
            drops: [
                {
                    name: 'Silk',
                    quantity: 20,
                    start_url: '../metaverse_modules/silk/',
                },
            ],
        };
        questManager.addQuest(quest);
    }, []);

    return (
        <div className={styles.quests}>
            {quests.map((quest, i) => {
                return (
                    <Quest
                        quest={quest}
                        enabled={enabled}
                        key={i}
                    />
                );
            })}
        </div>
    );
};